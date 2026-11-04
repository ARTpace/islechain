"""Bounded PCM WAV validation and deterministic audio test fixtures."""
import io
import wave

from pydantic import BaseModel, ConfigDict, Field


class AudioFixture(BaseModel):
    model_config = ConfigDict(extra='forbid')
    frames: int = Field(default=800, ge=1, le=48000)
    sampleRate: int = Field(default=8000, ge=8000, le=48000)
    channels: int = Field(default=1, ge=1, le=2)


class AudioExpectation(BaseModel):
    model_config = ConfigDict(extra='forbid')
    frames: int = Field(ge=1)
    sampleRate: int = Field(ge=8000, le=192000)
    channels: int = Field(ge=1, le=2)
    sha256: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')


def fixture_audio(value):
    item = AudioFixture.model_validate(value)
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as audio:
        audio.setnchannels(item.channels)
        audio.setsampwidth(2)
        audio.setframerate(item.sampleRate)
        audio.writeframes(b'\x00\x00' * item.frames * item.channels)
    return stream.getvalue()


def audio_bytes(raw):
    if not isinstance(raw, bytes) or not 1 <= len(raw) <= 8 * 1024**2:
        raise ValueError('WAV音频大小必须在8MiB以内')
    if raw[:4] != b'RIFF':
        from core.node_av import convert
        return convert(raw, 'audio')
    try:
        with wave.open(io.BytesIO(raw), 'rb') as audio:
            channels, width, rate, frames = audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getnframes()
            if (audio.getcomptype() != 'NONE' or channels not in (1, 2) or width != 2
                    or not 8000 <= rate <= 192000 or not 0 < frames <= rate * 300):
                raise ValueError('只支持最长300秒的16位单/双声道PCM WAV')
            data = audio.readframes(frames)
            if len(data) != frames * channels * width:
                raise ValueError('WAV音频帧数据不完整')
        stream = io.BytesIO()
        with wave.open(stream, 'wb') as output:
            output.setnchannels(channels); output.setsampwidth(width); output.setframerate(rate)
            output.writeframes(data)
        return stream.getvalue(), {'frames': frames, 'sampleRate': rate, 'channels': channels, 'duration': frames / rate}
    except (wave.Error, EOFError, OSError):
        raise ValueError('无效PCM WAV音频') from None
