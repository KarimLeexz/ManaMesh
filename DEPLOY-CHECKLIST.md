# Quick Deployment Checklist

## ☐ Step 1: Deploy Backend (5 minutes + waiting)

1. Go to https://render.com and sign up
2. Click "New +" → "Web Service"
3. Connect GitHub repo: `KarimLeexz/manamesh`
4. Configure:
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
   - Instance Type: Free
5. Click "Create Web Service"
6. **Copy your backend URL** (e.g., `https://manamesh-backend.onrender.com`)
7. Open Shell tab and run: `python backend/build_database.py` (wait 30-60 min)

## ☐ Step 2: Configure Frontend (2 minutes)

1. Edit `frontend/config.js`
2. Replace URL with your backend URL from Step 1
3. Save the file

## ☐ Step 3: Enable GitHub Pages (2 minutes)

1. Go to https://github.com/KarimLeexz/manamesh/settings/pages
2. Under "Build and deployment":
   - Source: **GitHub Actions** ✅
3. Click Save

## ☐ Step 4: Push to GitHub (1 minute)

```powershell
git add .
git commit -m "Deploy to GitHub Pages"
git push origin master
```

## ☐ Step 5: Wait & Test (5-10 minutes)

1. Go to https://github.com/KarimLeexz/manamesh/actions
2. Watch the deployment workflow
3. Once complete, visit: **https://karimleexz.github.io/manamesh/**

---

## 🎉 Done!

Your app is now live:
- Frontend: https://karimleexz.github.io/manamesh/
- Backend: https://your-backend-url.onrender.com

**Note**: Render free tier sleeps after 15 min of inactivity. First request after sleep takes ~30 seconds to wake up.

---

See `DEPLOYMENT.md` for detailed troubleshooting and advanced options.
