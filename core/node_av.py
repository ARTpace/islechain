"""Bounded media decoding in a separate bundled-Python process."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def convert(raw, kind):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= 8 * 1024**2:
        raise ValueError('媒体文件必须在8MiB以内')
    with tempfile.TemporaryDirectory(prefix='art-media-') as folder:
        root = Path(folder)
        (root / 'input.bin').write_bytes(raw)
        try:
            result = subprocess.run([sys.executable, '-I', '-B', str(Path(__file__).resolve()), kind, str(root)],
                env={key: value for key, value in os.environ.items() if key.upper() in ('SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP')},
                capture_output=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        except subprocess.TimeoutExpired:
            raise ValueError('媒体解码超过30秒，已终止') from None
        if result.returncode or len(result.stdout) > 4096:
            raise ValueError('媒体解码失败或超过限制；需MP3/AAC音频或H.264/AAC MP4视频')
        metadata = json.loads(result.stdout)
        encoded = (root / 'output.bin').read_bytes()
        if not 0 < len(encoded) <= 8 * 1024**2:
            raise ValueError('转换后的媒体超过8MiB')
        return encoded, metadata


def _decode(kind, root):
    import av
    import wave
    source, output = root / 'input.bin', root / 'output.bin'
    # Never allow a media container to open network protocols or external playlists.
    with av.open(str(source), options={'protocol_whitelist': 'file,pipe', 'err_detect': 'explode'}) as container:
        if kind == 'preview':
            if not container.streams.video:
                raise ValueError('video stream required')
            stream = container.streams.video[0]
            if not 0 < stream.codec_context.width * stream.codec_context.height <= 1920 * 1080:
                raise ValueError('preview dimensions limit')
            frame = next(container.decode(stream))
            image = frame.to_image()
            image.thumbnail((2048, 2048))
            image.save(output, format='PNG')
            return {'width': image.width, 'height': image.height}
        if kind == 'audio':
            if not container.streams.audio or container.streams.video:
                raise ValueError('audio stream required')
            stream = container.streams.audio[0]
            if stream.codec_context.name not in ('mp3', 'mp3float', 'aac', 'pcm_s16le'):
                raise ValueError('unsupported audio codec')
            rate, channels = 48000, min(2, stream.codec_context.channels)
            if channels < 1:
                raise ValueError('invalid channels')
            resampler = av.AudioResampler(format='s16', layout='mono' if channels == 1 else 'stereo', rate=rate)
            samples = 0
            with wave.open(str(output), 'wb') as wav:
                wav.setnchannels(channels); wav.setsampwidth(2); wav.setframerate(rate)
                for frame in container.decode(stream):
                    for part in resampler.resample(frame):
                        samples += part.samples
                        if samples > rate * 300 or samples * channels * 2 + 44 > 8 * 1024**2:
                            raise ValueError('audio limit')
                        wav.writeframes(bytes(part.planes[0])[:part.samples * channels * 2])
                for part in resampler.resample(None):
                    samples += part.samples
                    if samples * channels * 2 + 44 > 8 * 1024**2 or samples > rate * 300:
                        raise ValueError('audio limit')
                    wav.writeframes(bytes(part.planes[0])[:part.samples * channels * 2])
            if not samples:
                raise ValueError('empty audio')
            return {'frames': samples, 'sampleRate': rate, 'channels': channels, 'duration': samples / rate}
        if kind != 'video' or 'mp4' not in container.format.name or len(container.streams.video) != 1:
            raise ValueError('single MP4 video required')
        stream = container.streams.video[0]
        if stream.codec_context.name != 'h264' or len(container.streams.audio) > 1 or any(
                item.codec_context.name != 'aac' for item in container.streams.audio):
            raise ValueError('H264/AAC required')
        width, height = stream.codec_context.width, stream.codec_context.height
        if not 0 < width <= 1920 or not 0 < height <= 1920 or width * height > 1920 * 1080:
            raise ValueError('video dimensions limit')
        frames, duration, audio_samples = 0, 0.0, 0
        for packet in container.demux([stream, *container.streams.audio]):
            for frame in packet.decode():
                if isinstance(frame, av.VideoFrame):
                    frames += 1
                    if frames > 900 or frame.width != width or frame.height != height:
                        raise ValueError('video frames limit')
                    duration = max(duration, float(frame.time or 0))
                else:
                    audio_samples += frame.samples
                    if audio_samples > 192000 * 30:
                        raise ValueError('audio duration limit')
                if duration > 30:
                    raise ValueError('video duration limit')
        rate = float(stream.average_rate or 0)
        if not frames or not 0 < rate <= 60 or frames / rate > 30:
            raise ValueError('invalid video rate or duration')
        output.write_bytes(source.read_bytes())
        return {'width': width, 'height': height, 'frames': frames, 'duration': max(duration, frames / rate),
                'frameRate': rate, 'hasAudio': bool(container.streams.audio)}


if __name__ == '__main__':
    print(json.dumps(_decode(sys.argv[1], Path(sys.argv[2]))))
