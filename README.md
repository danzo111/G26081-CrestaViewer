# NetView — Stormwater & Sewer Network Viewer

## Overview

NetView is a dual-mode web application for viewing stormwater and sewer infrastructure networks. It features both a **simple 2D Map View** for daily use by facility managers and a **full 3D technical view** for engineers and contractors.

## File Structure

```
/
├── index.html          # Main HTML entry point
├── style.css           # All styles (5DGeo branded)
├── main.js             # Application entry point (Map + 3D views)
├── network.json        # Network data (manholes, pipes, metadata)
└── modules/
    ├── AppState.js         # Central state management
    ├── CoordinateSystem.js # Survey-to-scene transforms
    ├── DataLoader.js       # Async data loading with retry
    ├── DataTable.js        # Virtual scrolling manhole table
    ├── FlowArrows.js       # Flow direction visualization
    ├── GeometryBuilder.js  # 3D geometry construction
    ├── HelpModal.js        # Welcome & feature guide
    ├── Raycaster.js        # 3D object picking
    ├── SceneManager.js     # Three.js scene setup
    ├── SearchIndex.js      # Fast search & filter engine
    └── UIManager.js        # UI controllers & popups
```

## Two View Modes

### Map View (Recommended for Mall Managers)

**How to access:** Click the "Map View" button in the top header bar, or press `V`.

**Features:**
- **Clean 2D top-down map** with aerial basemap
- **Clickable manhole dots** with ID labels (Sewer = amber, Stormwater = cyan)
- **Pipe lines** overlaid on the map with matching colors
- **Static flow direction arrows** showing water flow
- **Search box** — type a manhole ID (e.g., "SE004") and press Enter to find and zoom to it
- **Click any manhole** to:
  - Open a popup with all technical data (cover elevation, invert, depth, coordinates)
  - View photos of the manhole
  - **Highlight the entire upstream network in green**
  - **Highlight the entire downstream network in red**
- **Layer toggles** — show/hide manholes, pipes, flow arrows, basemap
- **Minimal UI** — no complex controls, just what you need

**Legend:**
- 🟠 Amber dot = Sewer manhole
- 🔵 Cyan dot = Stormwater manhole
- 🟠 Amber line = Sewer pipe
- 🔵 Blue line = Stormwater pipe
- 🔵 Light blue triangle = Flow direction arrow
- 🟢 Green ring = Upstream network
- 🔴 Red ring = Downstream network

**Keyboard shortcuts in Map View:**
- `V` — Toggle between Map and 3D view
- `Esc` — Clear selection and hide highlights
- `?` — Open help guide

### 3D View (For Engineers & Technical Staff)

**How to access:** Click the "3D View" button in the top header bar, or press `V`.

**Features:**
- Full 3D visualization with shadows and lighting
- Separate meshes for Sewer (amber) and Stormwater (cyan) manhole covers
- Pipe geometry with diameter-based sizing
- Flow direction arrows (auto-fade with distance)
- Elevation profile charts for pipes
- Measure distance tool
- Multiple camera views (ISO, Top, Front, Right, Left, Back)
- Data table with search and filter
- Layer controls and basemap elevation/opacity sliders

**Keyboard shortcuts in 3D View:**
- `1-6` — Camera views (ISO, Top, Front, Right, Left, Back)
- `T` — Toggle data panel
- `F` — Toggle flow arrows
- `M` — Measure distance
- `Esc` — Clear selection
- `?` — Open help guide
- `V` — Toggle to Map View

## Upstream/Downstream Tracing

The network tracing feature is available in **Map View**:

1. Click any manhole on the map
2. The popup will show all manhole details
3. The entire **upstream network** (all pipes and manholes that flow INTO this one) will be highlighted in **green**
4. The entire **downstream network** (all pipes and manholes that flow OUT OF this one) will be highlighted in **red**
5. Press `Esc` or click empty space to clear the highlights

This is useful for:
- Understanding the drainage path
- Identifying which manholes affect a given location
- Tracing the source of a blockage or overflow

## Data Requirements

The app expects `network.json` in the same directory with this structure:

```json
{
  "metadata": {
    "project": "Project Name",
    "crs": "survey",
    "basemap_elev": 1546.83,
    "rotate_180": true,
    "basemap_bounds": { "left": ..., "right": ..., "bottom": ..., "top": ... }
  },
  "manholes": [
    {
      "id": "SE001",
      "name": "SE001",
      "type": "Sewer",
      "x": -97271.62,
      "y": 2891518.13,
      "cover_elev": 1560.82,
      "depth": 0.33,
      "diameter": 1.0,
      "images": ["images/SE001(1).jpg", "images/SE001(2).jpg"]
    }
  ],
  "pipes": [
    {
      "id": "P001",
      "from_mh": "SE001",
      "to_mh": "SE002",
      "from_depth": 1.78,
      "to_depth": 1.47,
      "diameter_mm": 110.0
    }
  ]
}
```

## Basemap

Place `basemap.png` in the same directory. The app will automatically:
- Rotate it 180° if `rotate_180: true` in metadata
- Position it using `basemap_bounds`
- Apply elevation offset from `basemap_elev`

## Browser Requirements

- Modern browser with WebGL support (Chrome, Firefox, Edge, Safari)
- JavaScript enabled
- Recommended: hardware acceleration enabled for smooth 3D

## Local Development

To run locally, you need a local web server (browsers block file:// requests for modules):

```bash
# Python 3
python -m http.server 8000

# Node.js
npx serve .

# Then open http://localhost:8000
```

## Customization

### Changing Colors
Edit the CSS variables in `style.css`:
```css
:root {
  --accent: #E87722;    /* Sewer / primary color */
  --storm: #00C8FF;     /* Stormwater color */
  --dark: #0D1E35;      /* Background */
  /* ... */
}
```

### Changing Map View Defaults
Edit `main.js` — look for `_buildMapView()` and `_setupMapCamera()` methods.

### Adding More Data Fields
The popup in `UIManager.js` `renderManholePopup()` method can be extended to show additional fields.

## Troubleshooting

**Basemap not showing:** Check browser console for CORS errors. Ensure `basemap.png` is in the same directory.

**3D view is slow:** Reduce browser zoom level or disable shadows in `SceneManager.js`.

**Search not finding manholes:** Ensure manhole IDs are uppercase in the JSON (e.g., "SE001" not "se001").

**Photos not loading:** Ensure image paths in `network.json` are correct relative to the HTML file.

## Support

For technical issues or feature requests, check the browser console (F12) for error messages first.
