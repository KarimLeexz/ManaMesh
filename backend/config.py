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
CARD_INDEX_PATH = os.getenv("CARD_INDEX_PATH", "card_index.npz")

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
# Maximum Hamming distance (out of 256 bits) between a scan and an index entry
# for the scan to count as a match. Lower = stricter (fewer wrong cards, more
# "not recognized"). 78 was measured against the full ~70k-entry index: beyond it,
# wrong matches rise much faster than correct ones.
MAX_HASH_DISTANCE = int(os.getenv("MAX_HASH_DISTANCE", "78"))

# Debugging aid: if set to a folder, every scan's image, click position and result are saved
# there, so real-world failures can be studied later. Off by default (frames stay private).
SAVE_SCANS_DIR = os.getenv("SAVE_SCANS_DIR", "").strip() or None
