# NetView — Stormwater & Sewer Network Viewer

## Overview

NetView is a dual-mode web application for viewing stormwater and sewer infrastructure networks. It features both a **simple 2D Map View** for daily use by facility managers and a **full 3D technical view** for engineers and contractors.

The current dataset covers **321 surveyed manholes** (234 stormwater, 75 sewer, 3 water, 9 unknown) and **419 pipes** (302 stormwater, 115 sewer, 2 water), plus **175 dummy junction nodes** used to represent polyline bends and pipe stubs. **160 manholes** are linked to on-site inspection photos.

The network is reconciled against the surveyed DXF linework (`data/dxf_overlay.json`). Every pipe records where it came from in a `diameter_source` field — surveyed deliverable, DXF-derived (auto stubs, uncovered linework, audited stubs), CSV import, or manual. The reconciliation, audit, and rendering scripts live in [`tools/`](tools/).

## File Structure

```
/
├── index.html              # Main HTML entry point
├── style.css               # All styles (5DGeo branded)
├── main.js                 # Application entry point (Map + 3D views)
├── data/
│   ├── network.json            # Primary network data (manholes + pipes)
│   ├── dxf_overlay.json        # Surveyed DXF wet-services linework (reconciliation source)
│   └── network_with_dummies.json  # Extended network (includes dummy nodes)
├── images/                 # Manhole inspection photos (JPG, ~1400px)
│   └── MAIN INDEX.html     # Photo index
├── tools/                  # Reconciliation, audit & rendering scripts (Python)
└── modules/
    ├── AppState.js             # Central state management
    ├── CoordinateSystem.js     # Survey-to-scene transforms
    ├── DataLoader.js           # Async data loading with retry
    ├── DataTable.js            # Virtual scrolling manhole table
    ├── FlowArrows.js           # Flow direction visualization (3D instanced mesh)
    ├── GeometryBuilder.js      # 3D geometry construction
    ├── HelpModal.js            # Welcome & feature guide
    ├── Raycaster.js            # 3D object picking
    ├── SceneManager.js         # Three.js scene setup
    ├── SearchIndex.js          # Fast search & filter engine
    └── UIManager.js            # UI controllers & popups
```

## Two View Modes

### Map View (Recommended for Mall Managers)

**How to access:** Click the "Map View" button in the top header bar, or press `V`.

**Features:**
- **Clean 2D top-down map** with aerial basemap
- **Clickable manhole dots** with ID labels (Sewer = amber, Stormwater = cyan)
- **Pipe lines** overlaid on the map with matching colors
- **Flow direction arrows** — static triangles showing water flow direction
- **Animated flow ribbons** — marching chevron overlays on pipes showing live flow animation (toggle with `F`)
- **Search box** — type a manhole ID (e.g., "SE004") and press Enter to find and zoom to it
- **Click any manhole** to:
  - Open a popup with all technical data (cover elevation, invert, depth, coordinates)
  - View inspection photos of the manhole
  - **Highlight the entire upstream network in green**
  - **Highlight the entire downstream network in red**
- **Layer toggles** — show/hide manholes, pipes, flow arrows, basemap
- **Minimal UI** — no complex controls, just what you need

**Legend:**
- Amber dot = Sewer manhole
- Cyan dot = Stormwater manhole
- Amber line = Sewer pipe
- Blue line = Stormwater pipe
- Light blue triangle = Flow direction arrow
- Green ring = Upstream network highlight
- Red ring = Downstream network highlight

**Keyboard shortcuts in Map View:**
- `V` — Toggle between Map and 3D view
- `F` — Toggle animated flow ribbons on/off
- `Esc` — Clear selection and hide highlights
- `?` — Open help guide

---

### 3D View (For Engineers & Technical Staff)

**How to access:** Click the "3D View" button in the top header bar, or press `V`.

**Features:**
- Full 3D visualization with shadows and lighting (Three.js)
- Separate meshes for Sewer (amber) and Stormwater (cyan) manhole covers
- Pipe geometry with diameter-based sizing
- **Flow direction arrows** — zoom-scaled instanced mesh (auto-fade with distance)
- Elevation profile charts for selected pipes
- Measure distance tool (click two ground points)
- Multiple camera views (ISO, Top, Front, Right, Left, Back)
- Data table with search and filter
- Layer controls and basemap elevation/opacity sliders

**Keyboard shortcuts in 3D View:**
- `1–6` — Camera views (ISO, Top, Front, Right, Left, Back)
- `T` — Toggle data panel
- `F` — Toggle flow arrows
- `M` — Measure distance
- `Esc` — Clear selection
- `?` — Open help guide
- `V` — Toggle to Map View

---

## Upstream/Downstream Tracing

Network tracing is available in **Map View**:

1. Click any manhole on the map
2. The popup shows all manhole details and inspection photos
3. The entire **upstream network** (pipes and manholes flowing INTO this one) highlights in **green**
4. The entire **downstream network** (pipes and manholes flowing OUT OF this one) highlights in **red**
5. Press `Esc` or click empty space to clear

Useful for:
- Understanding the drainage path through the network
- Identifying which manholes affect a given location
- Tracing the source of a blockage or overflow

---

## Flow Direction Logic

Water flows from **higher invert elevation** to **lower invert elevation**:

```
fromInvert = fromMH.cover_elev − pipe.from_depth
toInvert   = toMH.cover_elev   − pipe.to_depth
```

Dummy manholes (intermediate polyline nodes with no physical cover) inherit their elevation from their `parent_mh`, ensuring invert calculations remain consistent across segmented pipes. Flow arrows and animated chevrons both follow this same direction logic.

**Overriding direction:** a pipe with `"flow_override": true` (or any pipe touching a dummy node) ignores the invert gradient and flows in its authored `from_mh → to_mh` order. Use this where survey inverts are unreliable or a direction is known — to reverse an arrow, swap the pipe's `from_mh`/`to_mh` (and its `path`).

---

## Data Requirements

The app reads from `data/network.json` with this structure:

```json
{
  "metadata": {
    "project": "Project Name",
    "crs": "survey",
    "basemap_elev": 1546.83,
    "rotate_180": true,
    "basemap_bounds": { "left": -97791.36, "right": -97133.03, "bottom": 2891253.79, "top": 2891979.14 }
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
      "images": ["images/SE001(1).JPG"],
      "parent_mh": null
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

**Dummy manholes** have `"type": "Dummy"` and a non-null `parent_mh` field. They are hidden from the UI (popups, data table) but are used internally for pipe routing and flow calculations.

---

## Basemap

Place `basemap.png` in the project root. The app will automatically:
- Rotate it 180° if `rotate_180: true` in metadata
- Position it using `basemap_bounds`
- Apply elevation offset from `basemap_elev`

---

## Browser Requirements

- Modern browser with WebGL support (Chrome, Firefox, Edge, Safari)
- JavaScript enabled
- Hardware acceleration recommended for smooth 3D rendering

---

## Local Development

Browsers block `file://` module requests, so a local web server is required:

```bash
# Python 3
python -m http.server 8000

# Node.js
npx serve .

# Then open http://localhost:8000
```

---

## Customization

### Changing Colors
Edit CSS variables in [`style.css`](style.css):
```css
:root {
  --accent: #E87722;    /* Sewer / primary color */
  --storm: #00C8FF;     /* Stormwater color */
  --dark: #0D1E35;      /* Background */
}
```

### Changing Map View Defaults
Edit [`main.js`](main.js) — look for `_buildMapView()` and `_setupMapCamera()`.

### Adding More Data Fields
Extend [`modules/UIManager.js`](modules/UIManager.js) `renderManholePopup()` to show additional fields from the JSON.

---

## Troubleshooting

**Basemap not showing:** Check the browser console (F12) for CORS errors. Ensure `basemap.png` is in the project root.

**3D view is slow:** Reduce browser zoom or disable shadows in [`modules/SceneManager.js`](modules/SceneManager.js).

**Search not finding manholes:** Ensure manhole IDs in the JSON are uppercase (e.g., `"SE001"` not `"se001"`).

**Photos not loading:** Check that image paths in `network.json` match the actual filenames in the `images/` directory (case-sensitive on some servers).

**Flow arrows pointing wrong way:** Verify `cover_elev` and `depth` values are correct in the JSON. Arrows follow invert elevation — higher invert flows to lower.

---

## Support

For technical issues, open the browser console (F12) to check for error messages before raising a bug report.
