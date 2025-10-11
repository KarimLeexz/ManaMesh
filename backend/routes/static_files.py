"""
Static Files Routes
Serves frontend files with proper content types.
"""
from fastapi import APIRouter
from fastapi.responses import FileResponse
from pathlib import Path

try:
    from backend.config import FRONTEND_DIR
except ImportError:
    from config import FRONTEND_DIR

router = APIRouter()


# JavaScript module files
JS_FILES = [
    "app.js",
    "camera-manager.js",
    "webrtc-manager.js",
    "ui-controller.js",
    "recognition-handler.js"
]


@router.get("/")
async def root():
    """Serve the frontend index.html."""
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path))
    return {
        "message": "ManaMesh API",
        "docs": "/docs",
        "health": "/health"
    }


@router.get("/logo.png")
async def serve_logo():
    """Serve the logo image."""
    logo_path = FRONTEND_DIR / "logo.png"
    if logo_path.exists():
        return FileResponse(str(logo_path), media_type="image/png")
    return {"error": "logo.png not found"}


# Dynamically create routes for JS modules
def create_js_route(filename: str):
    """Factory function to create JavaScript file routes."""
    async def serve_js():
        js_path = FRONTEND_DIR / filename
        if js_path.exists():
            return FileResponse(str(js_path), media_type="application/javascript")
        return {"error": f"{filename} not found"}
    return serve_js


# Register all JS file routes
for js_file in JS_FILES:
    router.add_api_route(
        f"/{js_file}",
        create_js_route(js_file),
        methods=["GET"],
        name=f"serve_{js_file.replace('.', '_').replace('-', '_')}"
    )
