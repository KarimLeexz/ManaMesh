"""
ManaMesh - Main Application Entry Point
Multiplayer MTG Card Scanner with WebRTC

Refactored with modular architecture:
- routes/ - API endpoint handlers
- services/ - Business logic
- sockets/ - WebRTC signaling
- config.py - Configuration
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import socketio
import os

# Import configuration
try:
    from backend.config import (
        API_TITLE, API_DESCRIPTION, API_VERSION,
        CORS_ORIGINS, CORS_CREDENTIALS, CORS_METHODS, CORS_HEADERS,
        SOCKETIO_ASYNC_MODE, SOCKETIO_CORS_ORIGINS, 
        SOCKETIO_LOGGER, SOCKETIO_ENGINEIO_LOGGER,
        FRONTEND_DIR, CARD_INDEX_PATH
    )
    from backend.recognizer import get_recognizer
    from backend.routes import decklists, health, recognition, static_files, tables
    from backend.sockets.signaling import register_socket_handlers, clear_connected_users
except ImportError:
    from config import (
        API_TITLE, API_DESCRIPTION, API_VERSION,
        CORS_ORIGINS, CORS_CREDENTIALS, CORS_METHODS, CORS_HEADERS,
        SOCKETIO_ASYNC_MODE, SOCKETIO_CORS_ORIGINS,
        SOCKETIO_LOGGER, SOCKETIO_ENGINEIO_LOGGER,
        FRONTEND_DIR, CARD_INDEX_PATH
    )
    from recognizer import get_recognizer
    from routes import decklists, health, recognition, static_files, tables
    from sockets.signaling import register_socket_handlers, clear_connected_users


# Create Socket.IO server
sio = socketio.AsyncServer(
    async_mode=SOCKETIO_ASYNC_MODE,
    cors_allowed_origins=SOCKETIO_CORS_ORIGINS,
    logger=SOCKETIO_LOGGER,
    engineio_logger=SOCKETIO_ENGINEIO_LOGGER
)

# Register Socket.IO event handlers
register_socket_handlers(sio)


# Initialize resources on startup/shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize and cleanup resources."""
    # Startup
    try:
        # Initialize card recognition index
        get_recognizer(CARD_INDEX_PATH)
        print("✓ Card recognizer initialized successfully")
    except Exception as e:
        print(f"⚠️  Warning: {e}")
        print("   The API will start but card recognition may not work.")
        print("   Please run 'py backend/build_index.py' first.")
    
    print("✓ WebRTC signaling server ready")
    
    yield
    
    # Shutdown
    clear_connected_users()
    print("✓ Cleanup complete")


# Initialize FastAPI app
app = FastAPI(
    title=API_TITLE,
    description=API_DESCRIPTION,
    version=API_VERSION,
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=CORS_CREDENTIALS,
    allow_methods=CORS_METHODS,
    allow_headers=CORS_HEADERS,
)

# Mount static files (frontend)
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

# Include routers
app.include_router(health.router, tags=["Health"])
app.include_router(recognition.router, tags=["Recognition"])
app.include_router(tables.router, tags=["Tables"])
app.include_router(decklists.router, tags=["Decklists"])
app.include_router(static_files.router, tags=["Static Files"])

# Create ASGI app combining FastAPI and Socket.IO
# This MUST be at module level for uvicorn to find it
socket_app = socketio.ASGIApp(
    sio,
    other_asgi_app=app,
    socketio_path='socket.io/'
)


# Main entry point for direct execution
if __name__ == "__main__":
    try:
        import uvicorn
    except ImportError:
        print("❌ uvicorn not found. Please install it: pip install uvicorn")
        exit(1)
    
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    
    print(f"🚀 Starting ManaMesh API on http://{host}:{port}")
    print(f"📚 API Documentation: http://{host}:{port}/docs")
    print(f"🔌 WebRTC Signaling: ws://{host}:{port}/socket.io")
    
    # Run the combined Socket.IO + FastAPI app
    uvicorn.run(
        socket_app,
        host=host,
        port=port,
        log_level="info"
    )
