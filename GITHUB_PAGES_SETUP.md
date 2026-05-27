# NetView — GitHub Pages Deployment Guide

## Quick Setup Steps

### 1. Create a New GitHub Repository
- Go to https://github.com/new
- Name it `netview` (or whatever you prefer)
- Make it **Public** (required for free GitHub Pages)
- Do NOT initialize with README (we'll push our own)

### 2. Upload These Files
Upload the entire contents of this folder to your repo:

```
netview/
├── .nojekyll              ← Disables Jekyll processing
├── 404.html               ← SPA fallback (copy of index.html)
├── index.html             ← Main entry point
├── style.css              ← Styles
├── network.json           ← Your network data
├── main.js                ← App entry point
└── modules/
    ├── AppState.js
    ├── CoordinateSystem.js
    ├── DataLoader.js
    ├── DataTable.js
    ├── FlowArrows.js
    ├── GeometryBuilder.js
    ├── HelpModal.js
    ├── Raycaster.js
    ├── SceneManager.js
    ├── SearchIndex.js
    └── UIManager.js
└── images/                ← Create this folder, add your photos
    ├── SE001(1).jpg
    ├── SE001(2).jpg
    ├── SW001(1).jpg
    └── ... (all your manhole photos)
```

### 3. Enable GitHub Pages
1. Go to your repo on GitHub
2. Click **Settings** → **Pages** (left sidebar)
3. Under "Source", select **Deploy from a branch**
4. Select **main** branch, folder **/(root)**
5. Click **Save**

### 4. Add Your Assets

#### Basemap Image
- Place `basemap.png` in the root folder (same level as `index.html`)
- The app will automatically load it

#### Manhole Photos
- Place all `images/` folder contents in the `images/` folder
- Paths in `network.json` should match: `images/SE001(1).jpg`

### 5. Your Live URL
After deployment (takes ~2-3 minutes), your site will be at:

```
https://YOUR_USERNAME.github.io/netview/
```

Or if using a custom domain:
```
https://your-domain.com/
```

---

## File Structure Changes Made for GitHub Pages

| Issue | Fix Applied |
|-------|-------------|
| JS files in root, imports expected `./modules/` | Moved all modules to `modules/` folder |
| `DataLoader` used `./data/` base URL | Changed to `./` (root) |
| Duplicate `<base target="_blank">` tags | Removed duplicates |
| Jekyll might ignore files starting with `_` | Added `.nojekyll` file |
| SPA refresh gives 404 | Added `404.html` (copy of `index.html`) |

---

## Important Notes

### If Using a Custom Domain
1. Add a `CNAME` file in the root with your domain:
   ```
   www.yourdomain.com
   ```
2. Configure DNS A records to point to GitHub Pages IPs:
   ```
   185.199.108.153
   185.199.109.153
   185.199.110.153
   185.199.111.153
   ```

### If Your Repo Name Is Different
If your repo is NOT named `netview`, update the `base` tag in `index.html`:

```html
<base href="/YOUR_REPO_NAME/">
```

### Image Paths
Make sure `network.json` image paths are relative to the HTML file:
```json
"images": ["images/SE001(1).jpg", "images/SE001(2).jpg"]
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Modules not found" 404 errors | Check that all `.js` files are in `modules/` folder |
| Basemap not showing | Ensure `basemap.png` is in root, check browser console for CORS |
| Photos not loading | Verify `images/` folder exists with correct filenames |
| Styles look wrong | Hard refresh (Ctrl+F5) to clear cache |
| Site shows 404 on refresh | `404.html` should be present — wait 2-3 min for deploy |

---

## Pushing via Git (Alternative to Manual Upload)

```bash
cd netview-github-pages
git init
git add .
git commit -m "Initial NetView deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/netview.git
git push -u origin main
```

---

Built with NetView 3D — Stormwater & Sewer Network Viewer
