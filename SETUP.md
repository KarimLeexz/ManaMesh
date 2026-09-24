# 🔧 Setup Guide for Windows

## Step 1: Install Python

You need Python 3.9 or higher. Choose one option:

### Option A: Using winget (Recommended)
```powershell
winget install Python.Python.3.12
```

### Option B: Download from Python.org
1. Visit https://www.python.org/downloads/
2. Download Python 3.12 (latest stable)
3. **IMPORTANT**: Check "Add Python to PATH" during installation
4. Click "Install Now"

### Option C: Using Microsoft Store
1. Open Microsoft Store
2. Search for "Python 3.12"
3. Click "Get" to install

## Step 2: Verify Installation

Close and reopen PowerShell, then run:
```powershell
python --version
```

You should see: `Python 3.12.x` (or similar)

## Step 3: Install Dependencies

```powershell
# Navigate to project
cd d:\Repos\ManaMesh

# Create virtual environment
python -m venv .venv

# Activate virtual environment
.\.venv\Scripts\Activate.ps1

# If you get an execution policy error, run:
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Then try activating again
.\.venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt
```

## Step 4: Build Card Index

This downloads Scryfall data and builds the card hash index (~30-90 mins, resumable):

```powershell
python backend/build_index.py
```

**Note**: This creates a `card_index.npz` file (~5-10MB) with a hash for every card artwork.

## Step 5: Create .env File

```powershell
copy .env.example .env
```

## Step 6: Start the Server

```powershell
python backend/main.py
```

Or:

```powershell
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Only if you change the frontend (HTML/JS/CSS): rebuild the stylesheet with Node.js,
see "Changing the frontend" in README.md (`npm install`, then `npm run build`).

## Step 7: Open in Browser

Navigate to: **http://localhost:8000**

---

## Troubleshooting

### "python is not recognized"
- Python isn't installed or not in PATH
- Restart PowerShell after installing Python
- Try using `python3` or `py` instead of `python`

### "Execution policy" error when activating venv
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### "Cannot activate virtual environment"
Try using the .bat file instead:
```powershell
.\.venv\Scripts\activate.bat
```

### "pip install fails"
Make sure you're in the activated virtual environment (you should see `(.venv)` in your prompt)

### Port 8000 already in use
```powershell
# Use a different port
uvicorn backend.main:app --reload --port 8080
```

---

## Quick Start (After Python is Installed)

```powershell
# 1. Create and activate venv
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# 2. Install dependencies
pip install -r requirements.txt

# 3. Build card index (takes ~30-90 minutes)
python backend/build_index.py

# 4. Start server
python backend/main.py

# 5. Open http://localhost:8000
```

---

## Alternative: Run Without Virtual Environment

If you prefer to install globally (not recommended but works):

```powershell
pip install -r requirements.txt
python backend/build_index.py
python backend/main.py
```

---

## Need Help?

Check the main README.md for more details and troubleshooting tips!
