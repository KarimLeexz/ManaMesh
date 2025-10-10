# Use Python 3.14
FROM python:3.14-slim

# Install system dependencies for OpenCV and build tools for NumPy
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    gcc \
    g++ \
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

# Start command
CMD uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}
