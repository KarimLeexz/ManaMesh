# --- Stage 1: build the frontend stylesheet (Tailwind CSS + daisyUI) ---
FROM node:20-slim AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY frontend/src ./frontend/src
RUN npm run build

# --- Stage 2: runtime ---
FROM python:3.12-slim
WORKDIR /app

# opencv-python needs these even headless
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend ./backend
COPY frontend ./frontend
COPY card_index.npz .
COPY --from=frontend-build /app/frontend/app.css ./frontend/app.css

ENV HOST=0.0.0.0 PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["python", "backend/main.py"]
