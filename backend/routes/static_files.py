"""
Static Files Routes
Serves the frontend (index.html and its assets) with proper content types.
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

try:
    from backend.config import FRONTEND_DIR
except ImportError:
    from config import FRONTEND_DIR

router = APIRouter()

# Frontend asset -> content type
ASSETS = {
    "app.js": "application/javascript",
    "camera-manager.js": "application/javascript",
    "table-socket.js": "application/javascript",
    "media.js": "application/javascript",
    "vendor/socket.io.min.js": "application/javascript",
    "vendor/livekit-client.umd.js": "application/javascript",
    "table-view.js": "application/javascript",
    "game-tools.js": "application/javascript",
    "commander-picker.js": "application/javascript",
    "chat.js": "application/javascript",
    "counters.js": "application/javascript",
    "lobby.js": "application/javascript",
    "recognition-handler.js": "application/javascript",
    "app.css": "text/css",
    "logo.png": "image/png",
    "logo_image.png": "image/png",
    "logo_text.png": "image/png",
}

# Stylesheet changes should show up immediately during development
NO_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}


@router.get("/")
async def root():
    """The lobby: the list of tables."""
    lobby_path = FRONTEND_DIR / "lobby.html"
    if lobby_path.exists():
        return FileResponse(lobby_path)
    return {
        "message": "ManaMesh API",
        "docs": "/docs",
        "health": "/health"
    }


@router.get("/t/{table_id}")
async def table_page(table_id: str):
    """A table's link: the same page, which reads the table from the URL."""
    index_path = FRONTEND_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="index.html not found")
    return FileResponse(index_path)


def asset_route(filename: str, media_type: str):
    """Create the handler that serves one frontend asset."""
    headers = NO_CACHE_HEADERS if media_type == "text/css" else None

    async def serve_asset():
        path = FRONTEND_DIR / filename
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"{filename} not found")
        return FileResponse(path, media_type=media_type, headers=headers)

    return serve_asset


for _filename, _media_type in ASSETS.items():
    router.add_api_route(
        f"/{_filename}",
        asset_route(_filename, _media_type),
        methods=["GET"],
        include_in_schema=False,
    )
