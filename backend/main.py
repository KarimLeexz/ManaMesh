"""
FastAPI backend for ManaMesh - MTG card recognition with WebRTC signaling.
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import socketio
import cv2
import numpy as np
from pathlib import Path
import os
from recognizer import get_recognizer
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Create Socket.IO server
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins='*',
    logger=True,
    engineio_logger=False
)

# Store connected users
connected_users = {}  # {sid: {username, peerId}}

# Initialize card recognizer on startup using lifespan
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize and cleanup resources."""
    # Startup
    try:
        db_path = os.getenv("CARD_DATABASE_PATH", "card_hashes.pkl")
        get_recognizer(db_path)
        print("✓ Card recognizer initialized successfully")
    except FileNotFoundError as e:
        print(f"⚠️  Warning: {e}")
        print("   The API will start but card recognition will not work.")
        print("   Please run 'py backend/build_database.py' first.")
    
    print("✓ WebRTC signaling server ready")
    
    yield
    
    # Shutdown (cleanup if needed)
    connected_users.clear()

# Initialize FastAPI app
app = FastAPI(
    title="ManaMesh API",
    description="Real-time multiplayer MTG card scanner with WebRTC",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware - allow all origins for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files (frontend)
frontend_path = Path(__file__).parent.parent / "frontend"
if frontend_path.exists():
    app.mount("/static", StaticFiles(directory=str(frontend_path)), name="static")

# Socket.IO event handlers
@sio.event
async def connect(sid, environ):
    """Handle new client connection."""
    print(f"✓ Client connected: {sid}")

@sio.event
async def disconnect(sid):
    """Handle client disconnection."""
    if sid in connected_users:
        username = connected_users[sid].get('username', 'Unknown')
        print(f"✗ Client disconnected: {username} ({sid})")
        
        # Notify others that this user left
        await sio.emit('user-left', {'userId': sid}, skip_sid=sid)
        
        del connected_users[sid]

@sio.event
async def join(sid, data):
    """Handle user joining the room."""
    username = data.get('username', 'Anonymous')
    connected_users[sid] = {
        'username': username,
        'sid': sid
    }
    
    print(f"✓ User joined: {username} ({sid})")
    
    # Send list of existing users to the new user
    existing_users = [
        {'userId': user_sid, 'username': user_data['username']}
        for user_sid, user_data in connected_users.items()
        if user_sid != sid
    ]
    
    await sio.emit('existing-users', {'users': existing_users}, to=sid)
    
    # Notify others about new user
    await sio.emit('user-joined', {
        'userId': sid,
        'username': username
    }, skip_sid=sid)

@sio.event
async def signal(sid, data):
    """Forward WebRTC signaling messages between peers."""
    target_sid = data.get('to')
    signal_data = data.get('signal')
    
    if target_sid and target_sid in connected_users:
        await sio.emit('signal', {
            'from': sid,
            'signal': signal_data
        }, to=target_sid)

# Create ASGI app combining FastAPI and Socket.IO
# This MUST be at module level for uvicorn to find it
socket_app = socketio.ASGIApp(
    sio,
    other_asgi_app=app,
    socketio_path='socket.io/'  # Note: no leading slash, with trailing slash
)


@app.get("/")
async def root():
    """Serve the frontend index.html."""
    index_path = frontend_path / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path))
    return {
        "message": "ManaMesh API",
        "docs": "/docs",
        "health": "/health"
    }


@app.get("/app.js")
async def serve_app_js():
    """Serve the app.js file."""
    js_path = frontend_path / "app.js"
    if js_path.exists():
        return FileResponse(str(js_path), media_type="application/javascript")
    return {"error": "app.js not found"}


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    try:
        recognizer = get_recognizer()
        stats = recognizer.get_database_stats()
        return {
            "status": "healthy",
            "database_loaded": True,
            "stats": stats
        }
    except Exception as e:
        return {
            "status": "degraded",
            "database_loaded": False,
            "error": str(e)
        }


@app.post("/api/recognize")
async def recognize_card(file: UploadFile = File(...)):
    """
    Recognize a card from an uploaded image.
    
    Args:
        file: Image file (JPEG, PNG, etc.)
    
    Returns:
        Card information including name, image URL, and confidence
    """
    try:
        # Read uploaded file
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            raise HTTPException(status_code=400, detail="Invalid image file")
        
        # Get recognizer and process image
        recognizer = get_recognizer()
        threshold = int(os.getenv("RECOGNITION_THRESHOLD", "15"))
        result = recognizer.recognize(img, threshold=threshold)
        
        if result is None:
            return {
                "success": False,
                "message": "No card recognized. Try better lighting or a clearer image."
            }
        
        return {
            "success": True,
            "card": result
        }
        
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=503,
            detail="Card database not available. Please build the database first."
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing image: {str(e)}")


@app.get("/api/stats")
async def get_stats():
    """Get database statistics."""
    try:
        recognizer = get_recognizer()
        return recognizer.get_database_stats()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


if __name__ == "__main__":
    try:
        import uvicorn  # type: ignore
    except ImportError:
        print("❌ uvicorn not found. Please install it: pip install uvicorn")
        exit(1)
    
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    debug = os.getenv("DEBUG", "True").lower() == "true"
    
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
