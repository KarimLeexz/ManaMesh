# 🃏 ManaMesh

**Real-time multiplayer MTG card scanner with computer vision**

A web application for recognizing Magic: The Gathering cards using computer vision and perceptual hashing. Built as an alternative to Spelltable with better video quality and accurate card recognition.

## Features

- 📷 **Real-time Webcam Capture** - High-quality video feed (1920x1080)
- 🔍 **Fast Card Recognition** - Card outline detection + perceptual hashing, ~10 ms per scan
- 💾 **Lightweight Index** - A few MB covering every card artwork on Scryfall
- 🎨 **Modern UI** - Built with DaisyUI and Tailwind CSS
- 🌐 **Scryfall Integration** - High-resolution card images on demand
- 🌙 **Dark/Light Mode** - Toggle between themes

## Technology Stack

**Backend:**
- FastAPI (Python web framework)
- OpenCV + NumPy (card outline detection, art hashing, index lookup)
- Socket.IO (WebRTC signaling)

**Frontend:**
- Vanilla JavaScript
- DaisyUI + Tailwind CSS
- WebRTC for camera access

## Setup Instructions

### 1. Install Python Dependencies

```powershell
# Create virtual environment (optional but recommended)
python -m venv .venv
.\.venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Build the Card Index

This downloads card data and images from Scryfall and builds the hash index (~5-10MB):

```powershell
python backend/build_index.py
```

This takes roughly 30-90 minutes depending on your connection. You only need to do this once,
and it is resumable: if interrupted, run it again and it continues where it stopped.
Re-run it occasionally to pick up new sets.

**Options:**
- `--output card_index.npz` - Output path
- `--workers 8` - Parallel image downloads
- `--limit 500` - Only index the first N cards (quick test)
- `--bulk-file PATH` - Use a local Scryfall bulk file instead of downloading one

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
│   ├── recognizer.py        # Card recognition pipeline
│   ├── card_vision.py       # Card outline detection + art hashing
│   ├── card_index.py        # Hash index storage and lookup
│   └── build_index.py       # Index builder (downloads from Scryfall)
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

### Outline detection + perceptual hashing

Instead of storing 45GB of card images, we store a 256-bit **fingerprint of each card's artwork**:

1. `build_index.py` downloads each distinct card artwork once and hashes its art window
2. When scanning, the card outline is found and the card warped flat (perspective corrected)
3. The artwork is hashed (both orientations, plus tiny shifts to tolerate an imperfect outline)
4. The closest fingerprint in the index wins; the high-res image comes from Scryfall
5. If nothing is close enough, the scan is reported as "not recognized" rather than guessing

**Why not feature matching (ORB)?** It was tried first: it needs a comparison against every card per
scan (over a minute for the full database) and returns confident wrong answers on blurry input.
Hash lookup over the whole index is a single matrix multiply.

**Tuning:** a scan counts as a match if its closest fingerprint is within `MAX_HASH_DISTANCE` bits
(of 256; default 78, set in `.env`). Lower is stricter: fewer wrong cards, more "not recognized".
78 was measured against the full index using synthetically degraded webcam-style scans; if real
scans are too often rejected, raise it a little (each +6 or so trades noticeably more wrong matches).

## Deployment

Not set up yet; the planned target is a Hetzner server. The backend serves the frontend itself,
so a single process on a single host is all that is needed. The only build artifact to ship is
`card_index.npz` (a few MB).

## Future Enhancements

- [x] WebRTC multiplayer support ✅
- [ ] Room creation and joining
- [ ] Card history/collection tracking
- [ ] Batch scanning
- [ ] OCR fallback for difficult cards
- [ ] Mobile app version

## Troubleshooting

**"Card index not found"**
- Run `python backend/build_index.py` first

**"Camera not accessible"**
- Check browser permissions
- Try using HTTPS (required for some browsers)
- Use `localhost` instead of `127.0.0.1`

**"Card not recognized"**
- Improve lighting
- Hold card closer/straighter
- Try a different angle
- Keep the whole card in the selection box, with a plain background around it
- Check if card is in the index (recent sets need a rebuild of the index)

## License

MIT License - feel free to use and modify!

## Acknowledgments

- [Scryfall](https://scryfall.com) for their excellent API
- [DaisyUI](https://daisyui.com) for the beautiful components
