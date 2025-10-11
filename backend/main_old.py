"""
FastAPI backend for ManaMesh - MTG card recognition with WebRTC signaling.
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from typing import Optional
import socketio
import cv2
import numpy as np
from pathlib import Path
import os
try:
    # Try absolute import (for Railway deployment)
    from backend.recognizer import get_orb_recognizer as get_recognizer
except ImportError:
    # Fall back to relative import (for local development)
    from recognizer import get_orb_recognizer as get_recognizer
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
        # Initialize ORB database
        db_path = os.getenv("CARD_DATABASE_PATH", "card_features.pkl")
        get_recognizer(db_path)
        print("✓ Card recognizer initialized successfully")
            
    except Exception as e:
        print(f"⚠️  Warning: {e}")
        print("   The API will start but card recognition may not work.")
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

@sio.on('camera-status-changed')
async def handle_camera_status_changed(sid, data):
    """Handle camera enable/disable notifications."""
    enabled = data.get('enabled', False)
    username = connected_users.get(sid, {}).get('username', 'Unknown')
    
    print(f"📹 Camera {'enabled' if enabled else 'disabled'} for {username} ({sid})")
    
    # Broadcast to all other users
    await sio.emit('camera-status-changed', {
        'userId': sid,
        'enabled': enabled,
        'username': username
    }, skip_sid=sid)

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


@app.get("/camera-manager.js")
async def serve_camera_manager_js():
    """Serve the camera-manager.js file."""
    js_path = frontend_path / "camera-manager.js"
    if js_path.exists():
        return FileResponse(str(js_path), media_type="application/javascript")
    return {"error": "camera-manager.js not found"}


@app.get("/webrtc-manager.js")
async def serve_webrtc_manager_js():
    """Serve the webrtc-manager.js file."""
    js_path = frontend_path / "webrtc-manager.js"
    if js_path.exists():
        return FileResponse(str(js_path), media_type="application/javascript")
    return {"error": "webrtc-manager.js not found"}


@app.get("/ui-controller.js")
async def serve_ui_controller_js():
    """Serve the ui-controller.js file."""
    js_path = frontend_path / "ui-controller.js"
    if js_path.exists():
        return FileResponse(str(js_path), media_type="application/javascript")
    return {"error": "ui-controller.js not found"}


@app.get("/recognition-handler.js")
async def serve_recognition_handler_js():
    """Serve the recognition-handler.js file."""
    js_path = frontend_path / "recognition-handler.js"
    if js_path.exists():
        return FileResponse(str(js_path), media_type="application/javascript")
    return {"error": "recognition-handler.js not found"}


def preprocess_image(img: np.ndarray) -> np.ndarray:
    """
    Preprocess image to improve recognition quality.
    - Enhance contrast
    - Reduce noise
    - Normalize lighting
    """
    try:
        # Convert to LAB color space for better lighting adjustment
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        
        # Apply CLAHE (Contrast Limited Adaptive Histogram Equalization) to L channel
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        l = clahe.apply(l)
        
        # Merge channels
        enhanced = cv2.merge([l, a, b])
        
        # Convert back to BGR
        result = cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR)
        
        # Apply slight denoising
        result = cv2.fastNlMeansDenoisingColored(result, None, 10, 10, 7, 21)
        
        return result
        
    except Exception as e:
        print(f"⚠️  Preprocessing failed: {e}, using original image")
        return img


def detect_card(img: np.ndarray) -> Optional[np.ndarray]:
    """
    Detect and extract a card from an image using edge detection.
    Returns the largest rectangular contour that looks like a card.
    """
    try:
        # Convert to grayscale
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Apply Gaussian blur to reduce noise
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        
        # Edge detection
        edges = cv2.Canny(blurred, 50, 150)
        
        # Find contours
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        if not contours:
            return None
        
        # Sort contours by area (largest first)
        contours = sorted(contours, key=cv2.contourArea, reverse=True)
        
        # Look for rectangular contours
        for contour in contours[:10]:  # Check top 10 largest contours
            # Approximate contour to polygon
            peri = cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
            
            # If it's roughly rectangular (4 corners)
            if len(approx) == 4:
                area = cv2.contourArea(contour)
                img_area = img.shape[0] * img.shape[1]
                
                # Card should be at least 5% of image and not more than 95%
                if 0.05 < (area / img_area) < 0.95:
                    # Get bounding rectangle
                    x, y, w, h = cv2.boundingRect(approx)
                    
                    # Check aspect ratio (cards are roughly 2.5:3.5 = 0.714)
                    aspect_ratio = float(w) / h
                    if 0.5 < aspect_ratio < 1.0:  # Allow some tolerance
                        # Extract the card region with some padding
                        padding = 10
                        y1 = max(0, y - padding)
                        y2 = min(img.shape[0], y + h + padding)
                        x1 = max(0, x - padding)
                        x2 = min(img.shape[1], x + w + padding)
                        
                        return img[y1:y2, x1:x2]
        
        return None
        
    except Exception as e:
        print(f"Error in card detection: {e}")
        return None


@app.get("/logo.png")
async def serve_logo():
    """Serve the logo.png file."""
    logo_path = frontend_path / "logo.png"
    if logo_path.exists():
        return FileResponse(str(logo_path), media_type="image/png")
    return {"error": "logo.png not found"}


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
        
        print(f"📸 Received image: {img.shape[1]}x{img.shape[0]}px")
        
        # Preprocess image for better recognition
        img = preprocess_image(img)
        
        # Use ORB recognizer
        recognizer = get_recognizer()
        result = recognizer.recognize(img, min_matches=15)
        
        if result is None:
            print(f"⚠️  No match found")
            return {
                "success": False,
                "message": "No card recognized. Try better lighting or a clearer image."
            }
        
        print(f"✓ Recognized: {result['name']} ({result['num_matches']} matches)")
        
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
