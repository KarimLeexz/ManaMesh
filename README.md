# 🃏 ManaMesh

**Real-time multiplayer MTG card scanner with computer vision**

A web application for recognizing Magic: The Gathering cards using computer vision and perceptual hashing. Built as an alternative to Spelltable with better video quality and accurate card recognition.

## Features

- 📷 **Real-time Webcam Capture** - High-quality video feed (1920x1080)
- 🔍 **Fast Card Recognition** - Perceptual hashing for instant card identification
- 💾 **Lightweight Database** - Only ~12MB for 25,000+ cards
- 🎨 **Modern UI** - Built with DaisyUI and Tailwind CSS
- 🌐 **Scryfall Integration** - High-resolution card images on demand
- 🌙 **Dark/Light Mode** - Toggle between themes

## Technology Stack

**Backend:**
- FastAPI (Python web framework)
- OpenCV (image processing)
- ImageHash (perceptual hashing)
- Pillow (image manipulation)

**Frontend:**
- Vanilla JavaScript
- DaisyUI + Tailwind CSS
- WebRTC for camera access

## Setup Instructions

### 1. Install Python Dependencies

```powershell
# Create virtual environment (optional but recommended)
python -m venv venv
.\venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Build the Card Database

This downloads card data from Scryfall and builds a hash database (~12MB):

```powershell
python backend/build_database.py
```

This will take about 30-60 minutes depending on your internet speed. You only need to do this once!

**Options:**
- `--output card_hashes.pkl` - Output path
- `--hash-size 16` - Hash precision (default: 16)
- `--all-printings` - Include all printings instead of unique cards only

### 3. Create Environment File

```powershell
# Copy example env file
copy .env.example .env
```

Edit `.env` if you want to customize settings.

### 4. Start the Server

```powershell
python backend/main.py
```

Or use uvicorn directly:

```powershell
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

### 5. Open in Browser

Navigate to: **http://localhost:8000**

## Usage

1. **Allow Camera Access** - When prompted, grant camera permissions
2. **Point at Card** - Position a Magic card in front of your camera
3. **Click "Scan Card"** - The app will identify the card
4. **View Results** - High-res card image appears in the sidebar

### Tips for Best Results

- ✅ Good lighting is crucial
- ✅ Hold card flat and straight
- ✅ Fill most of the frame with the card
- ✅ Avoid glare on foil cards
- ✅ Make sure card name is visible

## Project Structure

```
ManaMesh/
├── backend/
│   ├── main.py              # FastAPI server
│   ├── recognizer.py        # Card recognition engine
│   └── build_database.py    # Database builder script
├── frontend/
│   ├── index.html           # Main UI
│   └── app.js               # Frontend logic
├── requirements.txt         # Python dependencies
├── .env.example            # Environment template
└── README.md               # This file
```

## API Endpoints

- `GET /` - Serve frontend
- `GET /health` - Health check and stats
- `GET /api/stats` - Database statistics
- `POST /api/recognize` - Recognize card from image

## How It Works

### Perceptual Hashing

Instead of storing 45GB of card images, we use **perceptual hashing**:

1. Download all MTG card images once
2. Create a "fingerprint" (hash) for each card
3. Store only the hash + metadata (~12MB total)
4. When scanning, compare captured image hash to database
5. Fetch high-res image from Scryfall API on match

**Benefits:**
- ⚡ Fast recognition (< 1 second)
- 💾 Tiny storage footprint
- 🎯 High accuracy (>90% confidence typical)
- 🌐 Always shows latest Scryfall images

## Deployment

### Quick Deploy (Free Hosting) 🚀

**Frontend**: GitHub Pages (configured with GitHub Actions)
**Backend**: Railway (recommended - no sleep time!)

#### Steps:

1. **Build database locally** (30-60 min, one-time):
   ```powershell
   .\prepare-deploy.ps1
   ```
   Then commit `card_hashes.pkl` to your repo.

2. **Deploy backend to [Railway](https://railway.app)** (5 min):
   - Sign in with GitHub
   - New Project → Deploy from GitHub repo
   - Select your repo → Auto-deploys! ✅
   - Generate domain and copy URL
   - See `RAILWAY-DEPLOY.md` for detailed guide

3. **Configure frontend** (1 min):
   - Edit `frontend/config.js` with your Railway URL
   - Example: `window.MANAMESH_API_URL = 'https://your-app.railway.app';`

4. **Enable GitHub Pages** (2 min):
   - Go to repo Settings → Pages
   - Source: "GitHub Actions"
   - Commit and push - automatic deployment!

5. **Your app is live!** 🎉
   - Frontend: `https://[username].github.io/manamesh/`
   - Backend: `https://your-app.railway.app`

**Why Railway?** $5/month credit = ~500 hours uptime with no sleep time (vs Render's 15-min sleep)

**Note**: `.python-version` and `runtime.txt` ensure Python 3.11.9 is used on hosting platforms.

## Future Enhancements

- [x] WebRTC multiplayer support ✅
- [ ] Room creation and joining
- [ ] Card history/collection tracking
- [ ] Batch scanning
- [ ] OCR fallback for difficult cards
- [ ] Mobile app version

## Troubleshooting

**"Card database not found"**
- Run `python backend/build_database.py` first

**"Camera not accessible"**
- Check browser permissions
- Try using HTTPS (required for some browsers)
- Use `localhost` instead of `127.0.0.1`

**"Card not recognized"**
- Improve lighting
- Hold card closer/straighter
- Try a different angle
- Check if card is in database (recent sets might be missing)

## License

MIT License - feel free to use and modify!

## Acknowledgments

- [Scryfall](https://scryfall.com) for their excellent API
- [ImageHash](https://github.com/JohannesBuchner/imagehash) library
- [DaisyUI](https://daisyui.com) for the beautiful components
