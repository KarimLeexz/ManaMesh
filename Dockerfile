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

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port (Railway sets PORT env var)
EXPOSE 8000

# Start command - use shell form to allow variable substitution
# Note: Railway uses socket_app (combined FastAPI + Socket.IO)
CMD ["sh", "-c", "uvicorn backend.main:socket_app --host 0.0.0.0 --port ${PORT:-8000}"]
