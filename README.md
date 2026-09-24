# 🃏 ManaMesh

**Real-time multiplayer MTG card scanner with computer vision**

A web application for recognizing Magic: The Gathering cards using computer vision and perceptual hashing. Built as an alternative to Spelltable with better video quality and accurate card recognition.

## Features

- 📷 **Real-time Webcam Capture** - High-quality video feed (1920x1080)
- 🔍 **Fast Card Recognition** - Card outline detection + perceptual hashing, ~10 ms per scan
- 💾 **Lightweight Index** - A few MB covering every card artwork on Scryfall
- 🎮 **Game table** - Spelltable-style: one big camera + small ones, or all cameras the same size, no scrolling
- ❤️ **Life & commanders** - Every player has a life counter (starts at 40) and a commander, synced for everyone
- 🎲 **Dice & coin** - d4, d6, d8, d10, d12, d20 and a coin flip, animated and shown to the whole table
- ⏭️ **Turns** - Random turn order per game, pass with Space, easy to undo
- 🔗 **Tables** - Every table has its own link; send it to your friends to sit down together
- 🔁 **Reconnect** - Reloading or a dropped connection keeps your seat, life and place in the turn order
- ⚔️ **Counters** - Commander damage (21 = out, also taken off life), poison (10 = out), energy, experience,
  the monarch and the initiative; players who are out are skipped when passing the turn
- 👁️ **Spectators** - Just watch a table (all cameras, no seat), and take a seat whenever you like
- 🔄 **New game** - Reset life, commanders or both for the whole table (starting life 20/30/40)
- 🪞 **Camera mirroring** - Mirror / flip your own camera for everyone, or anyone's camera just for you
- 🎨 **Modern UI** - Built with daisyUI 5 and Tailwind CSS 4
- 🌐 **Scryfall Integration** - High-resolution card images on demand
- 🌙 **Dark/Light Mode** - Toggle between themes

## Technology Stack

**Backend:**
- FastAPI (Python web framework)
- OpenCV + NumPy (card outline detection, art hashing, index lookup)
- Socket.IO (WebRTC signaling and the shared table state)

**Frontend:**
- Vanilla JavaScript
- daisyUI 5 + Tailwind CSS 4 (built with the Tailwind CLI)
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

### Changing the frontend (optional)

The page's stylesheet `frontend/app.css` is built from `frontend/src/app.css` (Tailwind CSS 4 +
daisyUI 5 + `frontend/styles.css`) and committed, so running the server needs no Node.js.
After changing HTML, JavaScript or CSS, rebuild it (needs [Node.js](https://nodejs.org) 20+):

```powershell
npm install        # once
npm run build      # or: npm run watch  (rebuilds on every save)
```

Tailwind only generates the classes it finds written out in `frontend/index.html` and
`frontend/*.js`. A class put together at runtime (like `alert-${type}`) must be listed in
`frontend/src/app.css` under `@source inline(...)`, otherwise it has no styles.

### 5. Open in Browser

Navigate to: **http://localhost:8000**

## Usage

1. **Join** - Opening the site starts a new table at its own link (`/t/brave-dragon-417`); send that link
   (🔗 button, or *Invite* in the join dialog) to your friends. Enter your name, pick your camera and
   mirror / flip it until your cards read the right way round (the preview shows exactly what the others
   see). Allow camera access when the browser asks. *Just watch* joins as a spectator: you see every
   camera but have no seat; *Take a seat* in the top bar makes you a player
2. **Layout** - The two buttons at the right of the top bar: *Focus* shows one camera big (tap a small one to swap), *Grid* shows everyone the same size
3. **Life** - Tap − / + on any player's tile (hold to count faster). Everyone can change everyone's life,
   so whoever deals the damage can count it
4. **Commander** - Tap *Commander* on your tile to search for it (partner / background: up to two)
5. **Counters** - The shield button next to a player's life opens their counters: commander damage taken
   from each opponent's commander (also comes off their life), poison, energy, experience, the monarch
   and the initiative, and *Out of the game* for conceding. Non-zero counters show as badges on the tile.
   At 0 life, 10 poison or 21 damage from one commander a player is out automatically: greyed out and
   skipped when passing the turn
6. **Dice & coin** - Top bar; the result pops up on every player's screen and lands in the *Log*
7. **Turns** - *Start turns* (or **Space**) shuffles a random turn order; after that **Space** or
   *Pass turn* passes it on, for whoever's turn it is. Passed by mistake? **Shift+Space** or ↶ takes
   it back, and the ⋮ menu on a tile gives the turn straight to that player. In *Focus* the player
   whose turn it is is shown big. Once there is a turn order, the cameras are arranged in it (seating order)
8. **Reset** - The ↺ button: choose life, commanders or everything, for the whole table. Resetting
   life starts a new game with a newly shuffled turn order
9. **Scan a card** - Tap a card in a big camera; the app identifies it and adds it to the *Cards* panel
10. **If it is not sure**, it offers up to 3 guesses over the video: tap the right one, or ignore them. Retrying the same spot rarely helps; use the guesses or the search box instead

The ⋮ menu on a tile mirrors that camera just for you, or (on your own tile) changes what everybody sees.

Reloading the page or losing the connection keeps your seat: life, counters, commanders and your place in
the turn order are waiting when you join again (the others see you as *Reconnecting…*). A seat is kept
for 15 minutes. Coming back in another tab or browser works too, as long as you use the same name.

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
│   ├── app.js               # Wires the modules together
│   ├── table-view.js        # Player tiles, layouts, life counters
│   ├── game-tools.js        # Dice, coin, reset, log
│   ├── commander-picker.js  # Commander search
│   ├── counters.js          # Counters, commander damage, monarch / initiative
│   ├── chat.js              # Table chat
│   ├── camera-manager.js    # Join dialog, local camera
│   ├── webrtc-manager.js    # Video connections + shared table state
│   └── recognition-handler.js # Card scanning, scanned cards, search
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
2. When you click, crops of several sizes around the click are searched for a card whose outline
   contains the click; each is warped flat (perspective corrected)
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
so a single process on a single host is all that is needed. The build artifacts to ship are
`card_index.npz` (a few MB) and `frontend/app.css`, both committed.

## Future Enhancements

- [x] WebRTC multiplayer support ✅
- [x] Room creation and joining ✅
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
- Click on the card's face, with the whole card in view (a few cards side by side is fine)
- Check if card is in the index (recent sets need a rebuild of the index)

## License

MIT License - feel free to use and modify!

## Acknowledgments

- [Scryfall](https://scryfall.com) for their excellent API
- [DaisyUI](https://daisyui.com) for the beautiful components
