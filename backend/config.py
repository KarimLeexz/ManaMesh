"""
Configuration settings for ManaMesh backend.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Paths
BASE_DIR = Path(__file__).parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
CARD_DATABASE_PATH = os.getenv("CARD_DATABASE_PATH", "card_features.pkl")

# API Configuration
API_TITLE = "ManaMesh API"
API_DESCRIPTION = "Real-time multiplayer MTG card scanner with WebRTC"
API_VERSION = "1.0.0"

# CORS Configuration
CORS_ORIGINS = ["*"]  # Allow all origins for development
CORS_CREDENTIALS = True
CORS_METHODS = ["*"]
CORS_HEADERS = ["*"]

# Socket.IO Configuration
SOCKETIO_ASYNC_MODE = 'asgi'
SOCKETIO_CORS_ORIGINS = '*'
SOCKETIO_LOGGER = True
SOCKETIO_ENGINEIO_LOGGER = False

# Recognition Configuration
MIN_MATCHES = 15  # Minimum feature matches for card recognition
CLAHE_CLIP_LIMIT = 2.0  # Contrast limit for image enhancement
CLAHE_TILE_GRID_SIZE = (8, 8)  # Tile grid size for CLAHE
DENOISE_H = 10  # Denoising filter strength
DENOISE_TEMPLATE_WINDOW_SIZE = 7
DENOISE_SEARCH_WINDOW_SIZE = 21

# Card Detection Configuration
CARD_MIN_AREA_RATIO = 0.05  # Minimum 5% of image
CARD_MAX_AREA_RATIO = 0.95  # Maximum 95% of image
CARD_ASPECT_RATIO_MIN = 0.5  # Min aspect ratio tolerance
CARD_ASPECT_RATIO_MAX = 1.0  # Max aspect ratio tolerance
CARD_PADDING = 10  # Padding around detected card
