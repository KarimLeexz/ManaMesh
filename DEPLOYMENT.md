# 🚀 Deployment Guide for ManaMesh

This guide will help you deploy ManaMesh with the frontend on GitHub Pages and the backend on Render (or another platform).

## Architecture

- **Frontend**: GitHub Pages (static hosting)
- **Backend**: Render, Railway, or your own server (Python/FastAPI)

---

## Part 1: Deploy Backend to Render (Free)

### Step 1: Create `requirements.txt` for Production

Make sure your `requirements.txt` includes all dependencies. Already done! ✅

### Step 2: Create `render.yaml` (optional)

This file tells Render how to deploy your app. Create it in the root directory:

```yaml
services:
  - type: web
    name: manamesh-backend
    env: python
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn backend.main:app --host 0.0.0.0 --port $PORT
    envVars:
      - key: CARD_DATABASE_PATH
        value: card_hashes.pkl
```

### Step 3: Deploy to Render

1. **Sign up** at https://render.com (free account)

2. **Create New Web Service**:
   - Click "New +" → "Web Service"
   - Connect your GitHub repository: `KarimLeexz/manamesh`
   - Settings:
     - **Name**: `manamesh-backend` (or whatever you prefer)
     - **Environment**: `Python 3`
     - **Build Command**: `pip install -r requirements.txt`
     - **Start Command**: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
     - **Plan**: Free

3. **Add Environment Variables** (if needed):
   - Go to "Environment" tab
   - Add any variables from your `.env` file

4. **Deploy**:
   - Click "Create Web Service"
   - Wait 5-10 minutes for deployment
   - You'll get a URL like: `https://manamesh-backend.onrender.com`

### Step 4: Build Card Database on Render

After deployment, you need to build the card database:

1. Go to your Render service dashboard
2. Click "Shell" tab (opens a terminal)
3. Run: `python backend/build_database.py`
4. Wait 30-60 minutes (only need to do this once!)

**Alternative**: Build the database locally and include `card_hashes.pkl` in your repo (but it's ~12MB).

---

## Part 2: Enable GitHub Pages

### Step 1: Configure Repository Settings

1. Go to your repository: https://github.com/KarimLeexz/manamesh

2. Click **Settings** → **Pages** (left sidebar)

3. Under "Build and deployment":
   - **Source**: GitHub Actions ✅ (not "Deploy from a branch")

4. Save changes

### Step 2: Update Frontend Configuration

1. Open `frontend/config.js`

2. Replace the API URL with your Render backend URL:
   ```javascript
   window.MANAMESH_API_URL = 'https://manamesh-backend.onrender.com';
   ```

3. **Commit and push**:
   ```powershell
   git add .
   git commit -m "Configure production API URL"
   git push origin master
   ```

### Step 3: Deploy!

The GitHub Action will automatically run when you push to `master`:

1. Go to **Actions** tab in your GitHub repo
2. Watch the deployment workflow run
3. Once complete, your site will be live at:
   ```
   https://karimleexz.github.io/manamesh/
   ```

---

## Part 3: Configure CORS on Backend

Your backend needs to allow requests from GitHub Pages:

### Update `backend/main.py`:

Find the CORS middleware section and update it:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "https://karimleexz.github.io",  # Add your GitHub Pages URL
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Or allow all origins (less secure but simpler):

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## Testing Your Deployment

1. **Visit your GitHub Pages URL**:
   ```
   https://karimleexz.github.io/manamesh/
   ```

2. **Check the browser console** (F12) for any errors

3. **Test features**:
   - ✅ Camera access
   - ✅ Card scanning (if database is built)
   - ✅ Multiplayer (WebRTC signaling)

---

## Troubleshooting

### Issue: "Failed to connect to backend"

**Solution**: 
- Check that your backend is running on Render
- Verify the API URL in `frontend/config.js` is correct
- Check CORS settings in `backend/main.py`

### Issue: "Card database not found"

**Solution**:
- Build the database on Render using the Shell
- Or commit `card_hashes.pkl` to your repo (add it to git, remove from .gitignore if needed)

### Issue: GitHub Pages not updating

**Solution**:
- Check the Actions tab for deployment status
- Make sure "GitHub Actions" is selected as the source in Pages settings
- Clear your browser cache

### Issue: WebRTC signaling not working

**Solution**:
- Make sure your Render backend is using HTTPS (it should by default)
- Check Socket.IO connection in browser console
- Verify the backend URL is correct

---

## Alternative: Deploy Everything to Render

If you prefer to deploy everything together:

1. Update `backend/main.py` to serve static files from `frontend/`
2. Deploy to Render with both frontend and backend
3. Skip GitHub Pages entirely

This is simpler but uses a single service.

---

## Cost Breakdown

- **GitHub Pages**: Free ✅
- **Render Free Tier**: 
  - 750 hours/month free compute
  - Service sleeps after 15 min of inactivity (wakes up in ~30 seconds)
  - Perfect for demos and low-traffic apps

- **To prevent sleeping**: Upgrade to paid plan ($7/month) or use a cron job to ping your app every 10 minutes

---

## Custom Domain (Optional)

Want to use your own domain like `manamesh.com`?

1. **Buy a domain** (Namecheap, Google Domains, etc.)

2. **Configure DNS**:
   - Frontend: Point to GitHub Pages (see GitHub docs)
   - Backend: Point to Render (see Render docs)

3. **Update URLs** in your code

---

## Questions?

- Check logs in Render dashboard
- Use browser DevTools console (F12)
- Check GitHub Actions logs
- Review CORS settings

Good luck! 🎉
