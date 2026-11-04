"""Small deterministic H.264 test clips and typed expectations."""
import io

from pydantic import BaseModel, ConfigDict, Field


class VideoFixture(BaseModel):
    model_config = ConfigDict(extra='forbid')
    width: int = Field(default=64, ge=16, le=256, multiple_of=2)
    height: int = Field(default=64, ge=16, le=256, multiple_of=2)
    frames: int = Field(default=4, ge=1, le=24)


class VideoExpectation(BaseModel):
    model_config = ConfigDict(extra='forbid')
    width: int = Field(ge=1, le=1920)
    height: int = Field(ge=1, le=1920)
    frames: int = Field(ge=1, le=900)
    sha256: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')


def fixture_video(value):
    import av
    from PIL import Image
    item = VideoFixture.model_validate(value)
    data = io.BytesIO()
    with av.open(data, 'w', format='mp4') as container:
        stream = container.add_stream('libx264', rate=12)
        stream.width = item.width; stream.height = item.height; stream.pix_fmt = 'yuv420p'
        stream.options = {'preset': 'ultrafast', 'crf': '28'}
        for index in range(item.frames):
            with Image.new('RGB', (item.width, item.height), (index * 10, 20, 40)) as image:
                frame = av.VideoFrame.from_image(image)
                frame.pts = index
                for packet in stream.encode(frame):
                    container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
    return data.getvalue()
