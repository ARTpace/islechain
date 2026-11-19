"""API platform request contracts; entry-point aliases remain compatible."""
from pydantic import BaseModel


class ApiProviderPayload(BaseModel):
    id: str = ""
    name: str = ""
    base_url: str = ""
    protocol: str = "openai"
    api_key: str | None = None
    image_models: list[str] = []
    chat_models: list[str] = []
    video_models: list[str] = []
    model_labels: dict[str, str] = {}
    primary: bool = False
    enabled: bool = True

class TestConnectionPayload(BaseModel):
    base_url: str = ""
    api_key: str = ""
    provider_id: str = ""

