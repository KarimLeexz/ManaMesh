# Use Python 3.14
FROM python:3.14-slim

# Install system dependencies for OpenCV, NumPy, Pillow, and uvloop
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    gcc \
    g++ \
    zlib1g-dev \
    libjpeg-dev \
    libtiff-dev \
    libfreetype6-dev \
    liblcms2-dev \
    libwebp-dev \
    make \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements first (for better caching)
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
# This includes the refactored structure:
# - backend/ (main.py, config.py, recognizer.py)
# - backend/routes/ (health.py, recognition.py, static_files.py)
# - backend/services/ (card_recognition.py)
# - backend/sockets/ (signaling.py)
# - frontend/
# - card_features.pkl (database)
COPY . .

# Expose port (Railway sets PORT env var)
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD python -c "import requests; requests.get('http://localhost:8000/health')" || exit 1

# Start command - use shell form to allow variable substitution
# Uses refactored backend.main:socket_app (FastAPI + Socket.IO)
CMD ["sh", "-c", "uvicorn backend.main:socket_app --host 0.0.0.0 --port ${PORT:-8000}"]
