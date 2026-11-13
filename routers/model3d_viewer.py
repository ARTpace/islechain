"""Standalone model viewer page shared by apps that are not a game project."""
from fastapi import APIRouter

from routers.game_model3d import preview_response

router = APIRouter()


@router.get("/api/model3d/viewer")
def model3d_viewer():
    """Same preview page as the canvas material viewer, with no model loaded yet."""
    return preview_response(None)
