/**
 * main.js — Network Viewer: Map View + 3D View
 * 
 * Two modes:
 *   - MAP VIEW: Simple 2D top-down for mall managers
 *   - 3D VIEW: Full technical 3D for engineers
 * 
 * Map View features:
 *   - Aerial basemap with overlaid pipes and manholes
 *   - Clickable manhole dots with ID labels
 *   - Flow direction arrows
 *   - Upstream/downstream network highlighting
 *   - Search by manhole ID
 *   - Popup with photos and all technical data
 *   - Minimal UI: legend, layer toggles, view toggle
 */

import * as THREE from 'three';
import { appState } from './modules/AppState.js';
import { dataLoader } from './modules/DataLoader.js';
import { CoordinateSystem } from './modules/CoordinateSystem.js';
import { SceneManager } from './modules/SceneManager.js';
import { GeometryBuilder } from './modules/GeometryBuilder.js';
import { RaycasterManager } from './modules/Raycaster.js';
import { UIManager } from './modules/UIManager.js';
import { SearchIndex } from './modules/SearchIndex.js';
import { FlowArrows } from './modules/FlowArrows.js';
import { DataTable } from './modules/DataTable.js';
import { Walkthrough } from './modules/Walkthrough.js';

class NetworkViewerApp {
  constructor() {
    this.ui = new UIManager();
    this.sceneManager = null;
    this.coordSystem = null;
    this.geometryBuilder = null;
    this.raycaster = null;
    this.basemapMesh = null;
    this.groundObjects = {};
    this.searchIndex = null;
    this.flowArrows = null;
    this.dataTable = null;
    this.helpModal = null;

    // Map View state
    this.mapMode = false;
    this.mapCamera = null;
    this.mapControls = null;
    this.mapManholeSprites = [];
    this.mapPipeLines = [];
    this.mapFlowArrows = [];
    this.mapUpstreamHighlights = [];
    this.mapDownstreamHighlights = [];
    this.mapSelectedManhole = null;
    this.mapFlowRibbons = [];        // animated marching-chevron flow overlays
    this._chevronCanvas = null;      // shared chevron canvas (one CanvasTexture per pipe)
    this._flowOn = false;            // flow visualization on/off
    this._sewerOn = true;            // pipe-type visibility (for flow gating)
    this._stormOn = true;
    this._flowLastT = 0;             // for frame-rate-independent animation

    // Network graph for tracing
    this.outgoingGraph = new Map();
    this.incomingGraph = new Map();
    this.pipeByEndpoints = new Map();

    this._searchDebounceTimer = null;
    this._bindMethods();
  }

  _bindMethods() {
    this._onViewportClick = this._onViewportClick.bind(this);
    this._onViewportMouseMove = this._onViewportMouseMove.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onMeasureClick = this._onMeasureClick.bind(this);
    this._animate = this._animate.bind(this);
  }

  async init() {
    try {
      this.ui.setProgress(5, 'Starting up...');
      await this._yieldFrame();

      this.sceneManager = new SceneManager('viewport');

      this.ui.setProgress(15, 'Loading network data...');
      const networkData = await dataLoader.loadNetworkData('network.json');

      this.ui.setProgress(30, `Found ${networkData.manholes.length} manholes and ${networkData.pipes.length} pipes...`);
      await this._yieldFrame();
      this.coordSystem = new CoordinateSystem(networkData);
      this.ui.setCRSLabel(this.coordSystem.getCRSLabel());

      this.ui.setProgress(32, 'Indexing manholes for search...');
      await this._yieldFrame();
      this.searchIndex = new SearchIndex(networkData, this.coordSystem);

      this.ui.setProgress(35, 'Mapping water-flow connections...');
      await this._yieldFrame();
      this._buildNetworkGraph(networkData);

      this.ui.setProgress(40, 'Building manholes & pipes...');
      await this._yieldFrame();
      this.geometryBuilder = new GeometryBuilder(this.sceneManager, this.coordSystem);

      const mhResult = this.geometryBuilder.buildManholes(networkData.manholes);
      const pipeResult = this.geometryBuilder.buildPipes(networkData.pipes, appState.mhLookup);

      this.flowArrows = new FlowArrows(
        this.sceneManager.scene,
        appState.pipeData,
        this.coordSystem,
        appState.mhLookup
      );

      this.ui.setProgress(60, 'Loading aerial basemap...');
      await this._yieldFrame();
      this.groundObjects = this.geometryBuilder.buildGround();
      this.geometryBuilder.buildDropLines(networkData.manholes);
      await this._loadBasemap();

      // DXF reference overlay — exact CAD linework, toggled from map controls
      try {
        const ovResp = await fetch('./data/dxf_overlay.json', { cache: 'no-cache' });
        if (ovResp.ok) {
          this.dxfOverlay = this.geometryBuilder.buildDxfOverlay(await ovResp.json());
        }
      } catch (e) {
        console.warn('DXF overlay unavailable:', e);
      }

      this.ui.setProgress(70, 'Preparing the map view...');
      await this._yieldFrame();
      this._buildMapView(networkData);

      this.ui.setProgress(80, 'Enabling clicks & search...');
      await this._yieldFrame();
      this.raycaster = new RaycasterManager(
        this.sceneManager.camera,
        this.sceneManager.renderer
      );
      this.raycaster.buildManholeIndex(appState.mhInstData);
      this.raycaster.buildPipeIndex(appState.pipeData);

      this._setupEventListeners();
      this._setupUIControls();
      this._setupSearchAndTable();
      this._setupFlowToggle();
      this._setupViewToggle();
      this._setupHelpModal();

      this.ui.setProgress(90, 'Framing the site...');
      await this._yieldFrame();
      const box = this.coordSystem.computeBoundingBox(networkData.manholes);
      this.sceneManager.frameCamera(box, 0.5);

      // Set up map camera position
      this._setupMapCamera(box);

      this.ui.setProgress(100, 'Ready!');
      await this._yieldFrame();
      await this._yieldFrame();
      this.ui.hideLoading();

      // Start in Map View by default (3D view disabled for client)
      this.mapMode = true;
      this._enterMapView();
      document.getElementById('viewport')?.classList.add('map-mode');

      this._animate();

    } catch (error) {
      this._handleFatalError(error);
    }
  }

  /**
   * Build directed network graph for upstream/downstream tracing.
   * Flow direction: higher invert → lower invert.
   */
  _buildNetworkGraph(networkData) {
    const { manholes, pipes } = networkData;
    const mhLookup = {};
    manholes.forEach(m => mhLookup[m.id] = m);

    pipes.forEach((p, i) => {
      const fromMH = mhLookup[p.from_mh];
      const toMH = mhLookup[p.to_mh];
      if (!fromMH || !toMH) return;

      let flowFrom, flowTo;
      const isDummyPipe = p.id && p.id.startsWith('DUMMY_PIPE');
      const hasFlowOverride = p.flow_override === true;
      // A dummy node's invert is inherited/arbitrary, so a gradient comparison
      // against it is meaningless — follow the authored from_mh -> to_mh instead.
      const touchesDummy = (p.from_mh && p.from_mh.startsWith('DUMMY')) ||
                           (p.to_mh && p.to_mh.startsWith('DUMMY'));

      if (isDummyPipe || hasFlowOverride || touchesDummy) {
        // Use JSON from_mh -> to_mh as the authoritative flow direction
        flowFrom = p.from_mh;
        flowTo = p.to_mh;
      } else {
        // Regular pipes: compute flow direction from invert elevations
        const fromInvert = fromMH.cover_elev - p.from_depth;
        const toInvert = toMH.cover_elev - p.to_depth;
        if (fromInvert >= toInvert) {
          flowFrom = p.from_mh;
          flowTo = p.to_mh;
        } else {
          flowFrom = p.to_mh;
          flowTo = p.from_mh;
        }
      }

      if (!this.outgoingGraph.has(flowFrom)) this.outgoingGraph.set(flowFrom, []);
      if (!this.incomingGraph.has(flowTo)) this.incomingGraph.set(flowTo, []);

      this.outgoingGraph.get(flowFrom).push({ to: flowTo, pipeIndex: i });
      this.incomingGraph.get(flowTo).push({ from: flowFrom, pipeIndex: i });

      // Store pipe by sorted endpoint pair for quick lookup
      const key = [flowFrom, flowTo].sort().join('::');
      this.pipeByEndpoints.set(key, i);
    });
  }

  /**
   * Trace upstream network from a manhole ID.
   * Returns { manholeIds: Set, pipeIndices: Set }
   */
  _traceUpstream(manholeId) {
    const manholeIds = new Set();
    const pipeIndices = new Set();
    const queue = [manholeId];

    while (queue.length > 0) {
      const current = queue.shift();
      if (manholeIds.has(current)) continue;
      manholeIds.add(current);

      const incoming = this.incomingGraph.get(current) || [];
      for (const { from, pipeIndex } of incoming) {
        pipeIndices.add(pipeIndex);
        if (!manholeIds.has(from)) {
          queue.push(from);
        }
      }
    }

    return { manholeIds, pipeIndices };
  }

  /**
   * Trace downstream network from a manhole ID.
   * Returns { manholeIds: Set, pipeIndices: Set }
   */
  _traceDownstream(manholeId) {
    const manholeIds = new Set();
    const pipeIndices = new Set();
    const queue = [manholeId];

    while (queue.length > 0) {
      const current = queue.shift();
      if (manholeIds.has(current)) continue;
      manholeIds.add(current);

      const outgoing = this.outgoingGraph.get(current) || [];
      for (const { to, pipeIndex } of outgoing) {
        pipeIndices.add(pipeIndex);
        if (!manholeIds.has(to)) {
          queue.push(to);
        }
      }
    }

    return { manholeIds, pipeIndices };
  }

  /**
   * Scene-space centreline points for a pipe. Follows the real DXF polyline
   * (pipe.path, in network coords, from_mh -> to_mh) when present; otherwise a
   * straight [p1, p2]. Intermediate elevations are interpolated between ends.
   */
  _pipeScenePoints(p, fromMH, toMH, p1, p2) {
    if (!p.path || p.path.length < 2) return [p1, p2];
    const eFrom = fromMH.cover_elev - p.from_depth;
    const eTo = toMH.cover_elev - p.to_depth;
    const n = p.path.length;
    const pts = p.path.map((xy, idx) => {
      const t = idx / (n - 1);
      return this.coordSystem.w2s(xy[0], xy[1], eFrom + (eTo - eFrom) * t);
    });
    pts[0] = p1; pts[n - 1] = p2;   // snap ends exactly to the manholes
    return pts;
  }

  /** Build a centreline curve from a stored mapPipeLines entry (bent if it has a path). */
  _pipeDataCurve(pd) {
    return (pd.pts && pd.pts.length > 2)
      ? new THREE.CatmullRomCurve3(pd.pts, false, 'centripetal')
      : new THREE.LineCurve3(pd.p1, pd.p2);
  }
  _pipeDataSeg(pd) {
    return (pd.pts && pd.pts.length > 2) ? Math.max((pd.pts.length - 1) * 8, 8) : 1;
  }

  _buildMapView(networkData) {
    const scene = this.sceneManager.scene;
    const { manholes, pipes } = networkData;

    // ── Manhole dots with labels ──
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 128;

    manholes.forEach((mh, i) => {
      // Skip dummy manholes — no symbols or labels on map
      const isDummy = mh.type === 'Dummy' || (mh.id && mh.id.startsWith('DUMMY'));
      if (isDummy) return;

      const pos = this.coordSystem.w2s(mh.x, mh.y, mh.cover_elev);

      // Create sprite for manhole dot
      const dotCanvas = document.createElement('canvas');
      const dotCtx = dotCanvas.getContext('2d');
      dotCanvas.width = 128;
      dotCanvas.height = 128;

      const isSewer = mh.type === 'Sewer';
      let color, glowA, glowB;
      if (isSewer) { color='#E87722'; glowA='rgba(232,119,34,0.25)'; glowB='rgba(232,119,34,0.4)'; }
      else if (mh.type === 'Water') { color='#0A3D91'; glowA='rgba(10,61,145,0.30)'; glowB='rgba(10,61,145,0.45)'; }   // WMH/Water = dark blue
      else if (mh.type === 'Unknown') { color='#FFFFFF'; glowA='rgba(255,255,255,0.30)'; glowB='rgba(255,255,255,0.5)'; }  // UK = white
      else { color='#00D4FF'; glowA='rgba(0,212,255,0.25)'; glowB='rgba(0,212,255,0.4)'; }

      // Outer glow
      dotCtx.beginPath();
      dotCtx.arc(64, 64, 44, 0, Math.PI * 2);
      dotCtx.fillStyle = glowA;
      dotCtx.fill();

      // Middle glow
      dotCtx.beginPath();
      dotCtx.arc(64, 64, 36, 0, Math.PI * 2);
      dotCtx.fillStyle = glowB;
      dotCtx.fill();

      // Main circle
      dotCtx.beginPath();
      dotCtx.arc(64, 64, 28, 0, Math.PI * 2);
      dotCtx.fillStyle = color;
      dotCtx.fill();

      // border — dark for white (Unknown) manholes so they stay visible
      dotCtx.strokeStyle = (mh.type === 'Unknown') ? '#2A3A4A' : '#ffffff';
      dotCtx.lineWidth = 5;
      dotCtx.stroke();

      // Inner highlight — skip for Water so WMH reads as solid dark navy like the water pipes
      if (mh.type !== 'Water') {
        dotCtx.beginPath();
        dotCtx.arc(64, 64, 20, 0, Math.PI * 2);
        dotCtx.fillStyle = 'rgba(255,255,255,0.2)';
        dotCtx.fill();
      }

      const dotTexture = new THREE.CanvasTexture(dotCanvas);
      const dotMaterial = new THREE.SpriteMaterial({ 
        map: dotTexture, 
        transparent: true,
        depthTest: false,
        depthWrite: false
      });
      const dotSprite = new THREE.Sprite(dotMaterial);
      dotSprite.position.set(pos.x, pos.y + 2.0, pos.z);
      dotSprite.userData = {
        type: 'manhole',
        index: i,
        manholeId: mh.id,
        isSewer,
        baseScale: new THREE.Vector3(21, 21, 1)   // 30 × 0.7 = 21
      };
      dotSprite.scale.copy(dotSprite.userData.baseScale);
      dotSprite.name = `map_mh_${i}`;
      dotSprite.visible = false;
      dotSprite.renderOrder = 1000;
      scene.add(dotSprite);
      this.mapManholeSprites.push(dotSprite);

      // Create label sprite
      const labelCanvas = document.createElement('canvas');
      const labelCtx = labelCanvas.getContext('2d');
      labelCanvas.width = 256;
      labelCanvas.height = 80;

      // Strong text outline for legibility
      labelCtx.font = 'bold 32px "Courier New", monospace';
      labelCtx.textAlign = 'center';
      labelCtx.textBaseline = 'middle';

      // Multiple outline passes for maximum contrast
      labelCtx.strokeStyle = '#0D1E35';
      labelCtx.lineWidth = 8;
      labelCtx.strokeText(mh.name, 128, 40);
      labelCtx.strokeStyle = '#000000';
      labelCtx.lineWidth = 5;
      labelCtx.strokeText(mh.name, 128, 40);

      // Main text
      labelCtx.fillStyle = isSewer ? '#E87722' : '#00D4FF';
      labelCtx.fillText(mh.name, 128, 40);

      const labelTexture = new THREE.CanvasTexture(labelCanvas);
      const labelMaterial = new THREE.SpriteMaterial({ 
        map: labelTexture, 
        transparent: true,
        depthTest: false,
        depthWrite: false
      });
      const labelSprite = new THREE.Sprite(labelMaterial);
      labelSprite.position.set(pos.x, pos.y + 2.0, pos.z);
      labelSprite.userData = {
        isSewer,
        baseScale: new THREE.Vector3(34, 11, 1)   // 48×15 × 0.7
      };
      labelSprite.scale.copy(labelSprite.userData.baseScale);
      labelSprite.visible = false;
      labelSprite.renderOrder = 1001;
      scene.add(labelSprite);
      this.mapManholeSprites.push(labelSprite);
    });

    // ── Pipe lines ──
    pipes.forEach((p, i) => {
      const fromMH = manholes.find(m => m.id === p.from_mh);
      const toMH = manholes.find(m => m.id === p.to_mh);
      if (!fromMH || !toMH) return;

      const p1 = this.coordSystem.w2s(fromMH.x, fromMH.y, fromMH.cover_elev - p.from_depth);
      const p2 = this.coordSystem.w2s(toMH.x, toMH.y, toMH.cover_elev - p.to_depth);

      const isWater = p.type === 'Water';
      const isStormwater = isWater
        ? true
        : (p.type
            ? p.type !== 'Sewer'
            : (fromMH.type === 'Stormwater' || toMH.type === 'Stormwater'));
      const color = isWater ? 0x0A3D91 : (isStormwater ? 0x4A90D9 : 0xD4880F);

      // Main pipe centreline — follow the real DXF path if present, else straight
      const pipePts = this._pipeScenePoints(p, fromMH, toMH, p1, p2);
      const bent = pipePts.length > 2;
      const pipeCurve = bent
        ? new THREE.CatmullRomCurve3(pipePts, false, 'centripetal')
        : new THREE.LineCurve3(p1, p2);
      const tubSeg = bent ? Math.max((pipePts.length - 1) * 8, 8) : 1;
      const tubeGeo = new THREE.TubeGeometry(pipeCurve, tubSeg, 0.6, 6, false);
      const tubeMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        depthWrite: false
      });
      const tube = new THREE.Mesh(tubeGeo, tubeMat);
      tube.visible = false;
      tube.name = `map_pipe_${i}`;
      tube.userData = { type: 'pipe', index: i };
      tube.renderOrder = 500;
      scene.add(tube);

      // Invisible hit target — much thicker for easy clicking when zoomed out
      const hitGeo = new THREE.TubeGeometry(pipeCurve, tubSeg, 2.5, 6, false);
      const hitMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.0,        // Completely invisible
        depthTest: false,
        depthWrite: false
      });
      const hitMesh = new THREE.Mesh(hitGeo, hitMat);
      hitMesh.visible = false;
      hitMesh.name = `map_pipe_hit_${i}`;
      hitMesh.userData = { type: 'pipe', index: i, isHitTarget: true };
      hitMesh.renderOrder = 499;  // Just below the visible pipe
      scene.add(hitMesh);

      this.mapPipeLines.push({ line: tube, hitMesh, index: i, p1, p2, pts: pipePts, isStormwater });

      // Flow direction arrow (filled triangle mesh)
      const mid = pipeCurve.getPoint(0.5);
      const dir = pipeCurve.getTangent(0.5).normalize();
      const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();

      let flowDir;
      const isDummyPipe = p.id && p.id.startsWith('DUMMY_PIPE');
      const hasFlowOverride = p.flow_override === true;
      const touchesDummy = (p.from_mh && p.from_mh.startsWith('DUMMY')) ||
                           (p.to_mh && p.to_mh.startsWith('DUMMY'));
      if (isDummyPipe || hasFlowOverride || touchesDummy) {
        // Use JSON from_mh -> to_mh as flow direction
        flowDir = dir;
      } else {
        // Regular pipes: compute from inverts
        const fromInvert = fromMH.cover_elev - p.from_depth;
        const toInvert = toMH.cover_elev - p.to_depth;
        flowDir = fromInvert >= toInvert ? dir : dir.clone().negate();
      }

      // Size the arrow to sit WITHIN the pipe band (pipe tube radius is 0.6, so
      // full width 1.2 m). Half-width = 0.35*size must stay < 0.6 → size ≤ ~1.4.
      // Because both arrow and pipe are world-space, this keeps the arrow inside
      // the pipe at every zoom level instead of ballooning when zoomed in.
      const arrowSize = 1.4;
      const tip   = mid.clone().add(flowDir.clone().multiplyScalar(arrowSize * 0.6));
      const left  = mid.clone().add(perp.clone().multiplyScalar(arrowSize * 0.35)).sub(flowDir.clone().multiplyScalar(arrowSize * 0.4));
      const right = mid.clone().sub(perp.clone().multiplyScalar(arrowSize * 0.35)).sub(flowDir.clone().multiplyScalar(arrowSize * 0.4));

      // Proper filled triangle with indices
      const arrowGeo = new THREE.BufferGeometry();
      arrowGeo.setAttribute('position', new THREE.Float32BufferAttribute([
        tip.x, tip.y, tip.z,
        left.x, left.y, left.z,
        right.x, right.y, right.z
      ], 3));
      arrowGeo.setIndex([0, 1, 2, 0, 2, 1]); // Double-sided rendering via indices
      arrowGeo.computeVertexNormals();

      const arrowMat = new THREE.MeshBasicMaterial({
        color: 0x00aaff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false
      });
      const arrowMesh = new THREE.Mesh(arrowGeo, arrowMat);
      arrowMesh.visible = false;
      arrowMesh.name = `map_flow_${i}`;
      arrowMesh.renderOrder = 600;
      arrowMesh.userData = { isStormwater };
      scene.add(arrowMesh);
      this.mapFlowArrows.push(arrowMesh);

      // ── Animated flow ribbon: marching chevrons along the pipe, pointing
      //    downstream. Sits within the pipe band and reads clearly in dense areas. ──
      const goesP1toP2 = flowDir.dot(dir) >= 0;
      // Ribbon follows the full pipe centreline (downstream order); chevrons march
      // along the real route, around bends. U accumulates by distance (≈1 per 4 m).
      const flowPts = goesP1toP2 ? pipePts : pipePts.slice().reverse();
      let ribTotal = 0;
      for (let k = 1; k < flowPts.length; k++) ribTotal += flowPts[k].distanceTo(flowPts[k - 1]);
      if (ribTotal > 0.05) {
        const halfW = 0.45, yL = 0.5;     // within pipe (tube radius 0.6); slight lift
        const pos = [], uvA = [], ind = [];
        let acc = 0;
        for (let k = 0; k < flowPts.length; k++) {
          const d = new THREE.Vector3();
          if (k < flowPts.length - 1) d.subVectors(flowPts[k + 1], flowPts[k]);
          else d.subVectors(flowPts[k], flowPts[k - 1]);
          d.y = 0; d.normalize();
          const pp = new THREE.Vector3(-d.z, 0, d.x).normalize();
          if (k > 0) acc += flowPts[k].distanceTo(flowPts[k - 1]);
          const u = acc / 4;
          const L = flowPts[k];
          pos.push(L.x + pp.x * halfW, L.y + yL, L.z + pp.z * halfW);
          pos.push(L.x - pp.x * halfW, L.y + yL, L.z - pp.z * halfW);
          uvA.push(u, 1, u, 0);
          if (k > 0) { const b0 = (k - 1) * 2, c0 = k * 2; ind.push(b0, b0 + 1, c0 + 1, b0, c0 + 1, c0); }
        }
        const ribGeo = new THREE.BufferGeometry();
        ribGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        ribGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
        ribGeo.setIndex(ind);
        if (!this._chevronCanvas) this._chevronCanvas = this._makeChevronCanvas();
        const tex = new THREE.CanvasTexture(this._chevronCanvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.repeat.set(1, 1);
        const ribMat = new THREE.MeshBasicMaterial({
          map: tex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide
        });
        const ribMesh = new THREE.Mesh(ribGeo, ribMat);
        ribMesh.name = `map_flowribbon_${i}`;
        ribMesh.renderOrder = 650;
        ribMesh.visible = false;
        scene.add(ribMesh);
        this.mapFlowRibbons.push({ mesh: ribMesh, tex, isStormwater });
      }
    });

    // ── Highlight meshes (upstream/downstream) ──
    // We'll create highlight lines that we can show/hide
    this._createHighlightMeshes();
  }

  _createHighlightMeshes() {
    const scene = this.sceneManager.scene;

    // Upstream highlight material (green)
    this.upstreamMat = new THREE.LineBasicMaterial({
      color: 0x2ECC71,
      linewidth: 5,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false
    });

    // Downstream highlight material (red)
    this.downstreamMat = new THREE.LineBasicMaterial({
      color: 0xE74C3C,
      linewidth: 5,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false
    });

    // Manhole highlight (green ring)
    this.upstreamMhMat = new THREE.MeshBasicMaterial({
      color: 0x2ECC71,
      transparent: true,
      opacity: 0.6
    });

    // Manhole highlight (red ring)
    this.downstreamMhMat = new THREE.MeshBasicMaterial({
      color: 0xE74C3C,
      transparent: true,
      opacity: 0.6
    });
  }

  _setupMapCamera(box) {
    const centre = new THREE.Vector3();
    box.getCenter(centre);
    const size = new THREE.Vector3();
    box.getSize(size);
    const span = Math.max(size.x, size.z) * 1.3;

    // Orthographic camera for map view
    const aspect = this.sceneManager.camera.aspect;
    const frustumSize = span;

    this.mapCamera = new THREE.OrthographicCamera(
      frustumSize * aspect / -2,
      frustumSize * aspect / 2,
      frustumSize / 2,
      frustumSize / -2,
      0.1,
      5000
    );

    this.mapCamera.position.set(centre.x, centre.y + span * 0.6, centre.z);
    this.mapCamera.lookAt(centre);
    this.mapCamera.up.set(0, 0, -1);

    // Store for later
    this.mapCameraTarget = centre.clone();
    this.mapCameraZoom = span;
  }

  _toggleMapMode() {
    // DISABLED: 3D view is hidden from client - only Map View is available
    // this.mapMode = !this.mapMode;
    // const viewport = document.getElementById('viewport');
    // const toggleBtn = document.getElementById('view-mode-toggle');
    // 
    // if (this.mapMode) {
    //   this._enterMapView();
    //   if (toggleBtn) toggleBtn.textContent = 'Switch to 3D View';
    //   viewport.classList.add('map-mode');
    // } else {
    //   this._enter3DView();
    //   if (toggleBtn) toggleBtn.textContent = 'Switch to Map View';
    //   viewport.classList.remove('map-mode');
    // }

    // Always stay in map mode
    this.mapMode = true;
    const viewport = document.getElementById('viewport');
    viewport.classList.add('map-mode');
    this._enterMapView();
  }

  _enterMapView() {
    // Hide 3D objects
    if (this.geometryBuilder.iCoversSewer) this.geometryBuilder.iCoversSewer.visible = false;
    if (this.geometryBuilder.iCoversStorm) this.geometryBuilder.iCoversStorm.visible = false;
    if (this.geometryBuilder.iShafts) this.geometryBuilder.iShafts.visible = false;

    const stormPipe = this.sceneManager.scene.getObjectByName('pipes_storm');
    const sewerPipe = this.sceneManager.scene.getObjectByName('pipes_sewer');
    if (stormPipe) stormPipe.visible = false;
    if (sewerPipe) sewerPipe.visible = false;

    const droplines = this.sceneManager.scene.getObjectByName('droplines');
    if (droplines) droplines.visible = false;

    if (this.flowArrows?.mesh) this.flowArrows.mesh.visible = false;

    // Show map objects
    this.mapManholeSprites.forEach(s => s.visible = true);
    this.mapPipeLines.forEach(p => { p.line.visible = true; if (p.hitMesh) p.hitMesh.visible = true; });

    const flowToggle = document.getElementById('flow-toggle');
    const showFlow = flowToggle?.classList.contains('active');
    this._flowOn = !!showFlow;
    this._sewerOn = document.getElementById('map-layer-sewer')?.checked ?? true;
    this._stormOn = document.getElementById('map-layer-storm')?.checked ?? true;
    this._applyFlowVisibility();

    // Switch camera
    this.sceneManager.camera = this.mapCamera;
    this.sceneManager.controls.object = this.mapCamera;

    // Adjust controls for 2D
    this.sceneManager.controls.maxPolarAngle = Math.PI * 0.001; // Lock to top-down
    this.sceneManager.controls.minPolarAngle = 0;
    this.sceneManager.controls.enableRotate = false;
    this.sceneManager.controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };

    // Hide 3D-specific UI COMPLETELY
    const controlPanel = document.getElementById('control-panel');
    if (controlPanel) {
      controlPanel.style.display = 'none';
      controlPanel.classList.add('hidden');
    }
    document.getElementById('view-buttons')?.classList.add('hidden');
    document.getElementById('data-toggle')?.classList.add('hidden');

    // Show map-specific UI
    const mapControls = document.getElementById('map-controls');
    if (mapControls) {
      mapControls.style.display = 'flex';
      mapControls.classList.add('visible');
    }

    this.sceneManager.controls.update();
  }

  _enter3DView() {
    // DISABLED: 3D view is not accessible to the client
    // All 3D view functionality is preserved in code but hidden from UI
    console.log('3D View is disabled - staying in Map View');
    this.mapMode = true;
    this._enterMapView();
  }

  _clearMapHighlights() {
    // Remove all highlight meshes
    this.mapUpstreamHighlights.forEach(m => this.sceneManager.scene.remove(m));
    this.mapDownstreamHighlights.forEach(m => this.sceneManager.scene.remove(m));
    this.mapUpstreamHighlights = [];
    this.mapDownstreamHighlights = [];
  }

  _showMapPopup() {
    // Add map-mode class for static right-side positioning
    const popup = document.getElementById('popup');
    if (popup) popup.classList.add('map-mode');
  }

  _hideMapPopup() {
    const popup = document.getElementById('popup');
    if (popup) popup.classList.remove('map-mode');
  }

  _highlightMapNetwork(manholeId) {
    this._clearMapHighlights();

    const upstream = this._traceUpstream(manholeId);
    const downstream = this._traceDownstream(manholeId);

    // ── UPSTREAM (GREEN) = Everything flowing INTO this manhole ──
    upstream.pipeIndices.forEach(idx => {
      const pipeData = this.mapPipeLines.find(p => p.index === idx);
      if (pipeData) {
        const path = this._pipeDataCurve(pipeData);
        const geo = new THREE.TubeGeometry(path, this._pipeDataSeg(pipeData), 1.2, 8, false);
        const mat = this.upstreamMat.clone();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = 200;
        this.sceneManager.scene.add(mesh);
        this.mapUpstreamHighlights.push(mesh);
      }
    });

    upstream.manholeIds.forEach(id => {
      if (id === manholeId) return; // Skip selected manhole (gets yellow ring)
      const mhIdx = appState.mhInstData.findIndex(m => m.id === id);
      if (mhIdx >= 0) {
        const mh = appState.mhInstData[mhIdx];
        const geo = new THREE.CircleGeometry(4.5, 16);
        const mat = this.upstreamMhMat.clone();
        mat.opacity = 0.5;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(mh.topS.x, mh.topS.y + 2.5, mh.topS.z);
        mesh.rotation.x = -Math.PI / 2;
        mesh.renderOrder = 102;
        this.sceneManager.scene.add(mesh);
        this.mapUpstreamHighlights.push(mesh);
      }
    });

    // ── DOWNSTREAM (RED) = Everything flowing OUT OF this manhole ──
    downstream.pipeIndices.forEach(idx => {
      const pipeData = this.mapPipeLines.find(p => p.index === idx);
      if (pipeData) {
        const path = this._pipeDataCurve(pipeData);
        const geo = new THREE.TubeGeometry(path, this._pipeDataSeg(pipeData), 1.2, 8, false);
        const mat = this.downstreamMat.clone();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = 200;
        this.sceneManager.scene.add(mesh);
        this.mapDownstreamHighlights.push(mesh);
      }
    });

    downstream.manholeIds.forEach(id => {
      if (id === manholeId) return; // Skip selected manhole
      const mhIdx = appState.mhInstData.findIndex(m => m.id === id);
      if (mhIdx >= 0) {
        const mh = appState.mhInstData[mhIdx];
        const geo = new THREE.CircleGeometry(4.5, 16);
        const mat = this.downstreamMhMat.clone();
        mat.opacity = 0.5;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(mh.topS.x, mh.topS.y + 2.5, mh.topS.z);
        mesh.rotation.x = -Math.PI / 2;
        mesh.renderOrder = 102;
        this.sceneManager.scene.add(mesh);
        this.mapDownstreamHighlights.push(mesh);
      }
    });

    // ── SELECTED MANHOLE gets a bright yellow ring ──
    const selectedIdx = appState.mhInstData.findIndex(m => m.id === manholeId);
    if (selectedIdx >= 0) {
      const mh = appState.mhInstData[selectedIdx];
      const geo = new THREE.RingGeometry(5.5, 7.5, 20);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xFFD700,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(mh.topS.x, mh.topS.y + 2.5, mh.topS.z);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 105;
      this.sceneManager.scene.add(mesh);
      this.mapUpstreamHighlights.push(mesh);
    }
  }

  _setupViewToggle() {
    // Add view toggle button to header
    const header = document.getElementById('header');
    const toggle = document.createElement('button');
    toggle.id = 'view-mode-toggle';
    toggle.className = 'view-mode-toggle';
    toggle.textContent = 'Map View';
    toggle.title = 'Toggle between Map and 3D view';

    // Insert before stats label
    const statsLabel = document.getElementById('stats-label');
    if (statsLabel && header) {
      header.insertBefore(toggle, statsLabel);
    } else if (header) {
      header.appendChild(toggle);
    }

    toggle.addEventListener('click', () => this._toggleMapMode());

    // Add map controls panel
    const mapControls = document.createElement('div');
    mapControls.id = 'map-controls';
    mapControls.innerHTML = `
      <div class="map-search">
        <input type="text" id="map-search-input" placeholder="Search manhole or pipe ID..." autocomplete="off">
        <button id="map-search-btn">🔍</button>
      </div>
      <div class="map-legend">
        <div class="map-legend-title">Legend</div>
        <div class="map-legend-item">
          <span class="map-dot sewer"></span>
          <span>Sewer Manhole</span>
        </div>
        <div class="map-legend-item">
          <span class="map-dot storm"></span>
          <span>Stormwater Manhole</span>
        </div>
        <div class="map-legend-item">
          <span class="map-dot" style="background:#0A3D91;"></span>
          <span>Water Manhole</span>
        </div>
        <div class="map-legend-item">
          <span class="map-dot" style="background:#fff;border:1px solid #2A3A4A;"></span>
          <span>Unknown Manhole</span>
        </div>
        <div class="map-legend-item">
          <span class="map-line sewer"></span>
          <span>Sewer Pipe</span>
        </div>
        <div class="map-legend-item">
          <span class="map-line storm"></span>
          <span>Stormwater Pipe</span>
        </div>
        <div class="map-legend-item">
          <span class="map-line" style="background:#0A3D91;"></span>
          <span>Water Pipe</span>
        </div>
        <div class="map-legend-item">
          <span class="map-arrow"></span>
          <span>Flow Direction</span>
        </div>
        <div class="map-legend-item">
          <span class="map-ring up"></span>
          <span>Upstream Network</span>
        </div>
        <div class="map-legend-item">
          <span class="map-ring down"></span>
          <span>Downstream Network</span>
        </div>
      </div>
      <div class="map-layers">
        <div class="map-legend-title">Layers</div>
        <label class="map-layer-item">
          <input type="checkbox" id="map-layer-mh-sewer" checked>
          <span style="color:#E87722;">● Sewer Manholes</span>
        </label>
        <label class="map-layer-item">
          <input type="checkbox" id="map-layer-mh-storm" checked>
          <span style="color:#00D4FF;">● Stormwater Manholes</span>
        </label>
        <label class="map-layer-item">
          <input type="checkbox" id="map-layer-sewer" checked data-toggle="pipes" data-type="sewer">
          <span style="color:#D4880F;">● Sewer Pipes</span>
        </label>
        <label class="map-layer-item">
          <input type="checkbox" id="map-layer-storm" checked data-toggle="pipes" data-type="storm">
          <span style="color:#4A90D9;">● Stormwater Pipes</span>
        </label>
        <label class="map-layer-item">
          <input type="checkbox" id="map-layer-basemap" checked>
          <span>Basemap</span>
        </label>
        <label class="map-layer-item">
          <input type="checkbox" id="map-layer-dxf">
          <span>DXF Overlay (exact CAD)</span>
        </label>
      </div>
      <div class="map-hint">
        <strong>Click a manhole</strong> to see details and trace upstream/downstream network.
      </div>
    `;
    document.body.appendChild(mapControls);

    // Map search functionality
    const searchInput = document.getElementById('map-search-input');
    const searchBtn = document.getElementById('map-search-btn');

    const doSearch = () => {
      const query = searchInput.value.trim().toUpperCase();
      if (!query) return;

      // First try manhole search
      const result = this.searchIndex.findById(query);
      if (result) {
        const mh = appState.mhInstData[result.index];
        const isDummy = mh && (mh.type === 'Dummy' || (mh.id && mh.id.startsWith('DUMMY')));
        if (!isDummy) {
          this._flyToManholeMap(result.index);
          this._selectMapManhole(result.index);
          return;
        }
      }

      // Try partial match for manholes — skip dummy manholes
      const matches = this.searchIndex.search(query);
      for (const match of matches) {
        const mh = appState.mhInstData[match.index];
        const isDummy = mh && (mh.type === 'Dummy' || (mh.id && mh.id.startsWith('DUMMY')));
        if (!isDummy) {
          this._flyToManholeMap(match.index);
          this._selectMapManhole(match.index);
          return;
        }
      }

      // If no manhole found, try pipe search
      const pipeResult = this._searchPipeById(query);
      if (pipeResult !== null) {
        this._flyToPipeMap(pipeResult);
        this._selectMapPipe(pipeResult);
        return;
      }
    };

    searchBtn.addEventListener('click', doSearch);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch();
    });

    // Separate manhole layer toggles — sewer and stormwater
    const updateManholeVisibility = () => {
      const sewerOn = document.getElementById('map-layer-mh-sewer')?.checked ?? true;
      const stormOn = document.getElementById('map-layer-mh-storm')?.checked ?? true;
      this.mapManholeSprites.forEach(s => {
        const on = s.userData.isSewer ? sewerOn : stormOn;
        s.visible = on;
      });
    };
    document.getElementById('map-layer-mh-sewer')?.addEventListener('change', updateManholeVisibility);
    document.getElementById('map-layer-mh-storm')?.addEventListener('change', updateManholeVisibility);

    // Separate toggles for sewer and stormwater pipes (also gate their flow viz)
    const updatePipeVisibility = () => {
      this._sewerOn = document.getElementById('map-layer-sewer')?.checked ?? true;
      this._stormOn = document.getElementById('map-layer-storm')?.checked ?? true;
      this.mapPipeLines.forEach(p => {
        const isVisible = p.isStormwater ? this._stormOn : this._sewerOn;
        p.line.visible = isVisible;
        if (p.hitMesh) p.hitMesh.visible = isVisible;
      });
      this._applyFlowVisibility();   // keep arrows/ribbons in sync with pipe types
    };
    document.getElementById('map-layer-sewer')?.addEventListener('change', updatePipeVisibility);
    document.getElementById('map-layer-storm')?.addEventListener('change', updatePipeVisibility);

    document.getElementById('map-layer-basemap')?.addEventListener('change', (e) => {
      if (this.basemapMesh) this.basemapMesh.visible = e.target.checked;
    });

    document.getElementById('map-layer-dxf')?.addEventListener('change', (e) => {
      if (this.dxfOverlay) this.dxfOverlay.visible = e.target.checked;
    });
  }

  _flyToManholeMap(index) {
    const mh = appState.mhInstData[index];
    if (!mh || !this.mapCamera) return;

    // Skip dummy manholes
    const isDummy = mh.type === 'Dummy' || (mh.id && mh.id.startsWith('DUMMY'));
    if (isDummy) return;

    const target = mh.topS.clone();
    const currentPos = this.mapCamera.position.clone();
    const startTarget = this.sceneManager.controls.target.clone();

    // Animate camera
    const startTime = performance.now();
    const duration = 600;

    const animate = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);

      this.mapCamera.position.lerpVectors(currentPos, new THREE.Vector3(target.x, currentPos.y, target.z), ease);
      this.sceneManager.controls.target.lerpVectors(startTarget, target, ease);
      this.sceneManager.controls.update();

      if (t < 1) requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }
  /**
   * Search for a pipe by ID (exact or partial match).
   * Returns the pipeData index or null if not found.
   */
  _searchPipeById(query) {
    if (!query || !appState.pipeData) return null;
    const q = query.toUpperCase();

    // Exact match first
    for (let i = 0; i < appState.pipeData.length; i++) {
      const pd = appState.pipeData[i];
      if (pd && pd.id && pd.id.toUpperCase() === q) {
        return i;
      }
    }

    // Partial match
    for (let i = 0; i < appState.pipeData.length; i++) {
      const pd = appState.pipeData[i];
      if (pd && pd.id && pd.id.toUpperCase().includes(q)) {
        return i;
      }
    }

    return null;
  }

  /**
   * Fly camera to a pipe's midpoint in map view.
   */
  _flyToPipeMap(index) {
    const pd = appState.pipeData[index];
    if (!pd || !this.mapCamera) return;

    const mid = new THREE.Vector3().addVectors(pd.p1, pd.p2).multiplyScalar(0.5);
    const currentPos = this.mapCamera.position.clone();
    const startTarget = this.sceneManager.controls.target.clone();

    // Animate camera
    const startTime = performance.now();
    const duration = 600;

    const animate = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);

      this.mapCamera.position.lerpVectors(currentPos, new THREE.Vector3(mid.x, currentPos.y, mid.z), ease);
      this.sceneManager.controls.target.lerpVectors(startTarget, mid, ease);
      this.sceneManager.controls.update();

      if (t < 1) requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }


  _selectMapManhole(index) {
    const mh = appState.mhInstData[index];
    if (!mh) return;

    // Skip dummy manholes — they have no symbols and should not be selectable
    const isDummy = mh.type === 'Dummy' || (mh.id && mh.id.startsWith('DUMMY'));
    if (isDummy) return;

    this.mapSelectedManhole = mh.id;
    this._highlightMapNetwork(mh.id);

    // Get trace counts for the popup
    const upstream = this._traceUpstream(mh.id);
    const downstream = this._traceDownstream(mh.id);

    // Static right-side positioning for map view
    this._showMapPopup();
    this.ui.renderManholePopup(mh, {
      upstreamCount: upstream.manholeIds.size - 1,
      downstreamCount: downstream.manholeIds.size - 1,
      upstreamPipeCount: upstream.pipeIndices.size,
      downstreamPipeCount: downstream.pipeIndices.size
    });
  }

  _selectMapPipe(index) {
    const pd = appState.pipeData[index];
    if (!pd) return;

    this._clearMapHighlights();
    this.mapSelectedManhole = null;

    // Highlight the pipe in map view
    const pipeData = this.mapPipeLines.find(p => p.index === index);
    if (pipeData) {
      const path = this._pipeDataCurve(pipeData);
      const geo = new THREE.TubeGeometry(path, this._pipeDataSeg(pipeData), 1.5, 8, false);
      const mat = new THREE.MeshBasicMaterial({
        color: pd.isStormwater ? 0x66b3ff : 0xffdd44,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 200;
      this.sceneManager.scene.add(mesh);
      this.mapUpstreamHighlights.push(mesh); // reuse array for selection highlight

      // Also highlight the hit target so it remains clickable
      if (pipeData.hitMesh) {
        const hitGeo = new THREE.TubeGeometry(path, 1, 2.5, 8, false);
        const hitMat = new THREE.MeshBasicMaterial({
          color: pd.isStormwater ? 0x66b3ff : 0xffdd44,
          transparent: true,
          opacity: 0.0,
          depthTest: false,
          depthWrite: false
        });
        const hitHighlight = new THREE.Mesh(hitGeo, hitMat);
        hitHighlight.renderOrder = 199;
        hitHighlight.userData = { type: 'pipe', index: index, isHitTarget: true };
        this.sceneManager.scene.add(hitHighlight);
        this.mapUpstreamHighlights.push(hitHighlight);
      }
    }

    // Map View: Show pipe popup with embedded elevation profile
    this._showMapPopup();
    this.ui.renderPipePopupWithProfile(pd);
  }

  /**
   * Project a manhole's scene position to screen coordinates for popup placement.
   */
  _getManholeScreenPos(mh) {
    if (!this.mapCamera || !this.sceneManager.renderer) return null;
    const pos = mh.topS.clone();
    pos.project(this.mapCamera);
    const rect = this.sceneManager.renderer.domElement.getBoundingClientRect();
    return {
      x: (pos.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (-(pos.y * 0.5) + 0.5) * rect.height + rect.top
    };
  }

  // ── Modified event handlers for map mode ──

  _onViewportClick(event) {
    if (appState.measureMode && !this.mapMode) {
      this._onMeasureClick(event);
      return;
    }

    if (this.mapMode) {
      this._onMapClick(event);
      return;
    }

    const result = this.raycaster.castRay(event);

    if (!result) {
      appState.clearSelection();
      this.geometryBuilder.resetManholeColors();
      this.geometryBuilder.clearPipeHighlight();
      this.ui.hidePopup();
      this.ui.hideProfile();
      return;
    }

    appState.clearSelection();
    this.ui.hidePopup();

    const { type, idx } = result;

    if (type === 'manhole') {
      this._selectManhole(idx);
    } else {
      this._selectPipe(idx);
    }
  }

  _onMapClick(event) {
    const rect = this.sceneManager.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.mapCamera);

    // Check manhole sprites first (higher priority)
    // Filter out dummy manholes — they have no symbols on the map
    const manholeSprites = this.mapManholeSprites.filter(s => {
      if (!s.name?.startsWith('map_mh_') || !s.visible) return false;
      const mhIdx = s.userData.index;
      const mh = appState.mhInstData[mhIdx];
      if (!mh) return false;
      const isDummy = mh.type === 'Dummy' || (mh.id && mh.id.startsWith('DUMMY'));
      return !isDummy;
    });

    const mhIntersects = raycaster.intersectObjects(manholeSprites);

    if (mhIntersects.length > 0) {
      const sprite = mhIntersects[0].object;
      const index = sprite.userData.index;
      this._selectMapManhole(index);
      return;
    }

    // Check pipe lines (including invisible hit targets for easier clicking)
    const visiblePipes = this.mapPipeLines.filter(p => p.line.visible);
    const pipeMeshes = visiblePipes.map(p => p.line);
    const hitMeshes = visiblePipes.map(p => p.hitMesh).filter(Boolean);
    const allPipeMeshes = [...pipeMeshes, ...hitMeshes];

    const pipeIntersects = raycaster.intersectObjects(allPipeMeshes);

    if (pipeIntersects.length > 0) {
      const hitObj = pipeIntersects[0].object;
      const index = hitObj.userData.index;
      this._selectMapPipe(index);
      return;
    }

    // Clicked empty space - clear selection
    this._clearMapHighlights();
    this.mapSelectedManhole = null;
    this._hideMapPopup();
    this.ui.hidePopup();
  }

  _onViewportMouseMove(event) {
    if (this.mapMode) {
      const rect = this.sceneManager.renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, this.mapCamera);

      const manholeSprites = this.mapManholeSprites.filter(s => 
        s.name?.startsWith('map_mh_') && s.visible
      );

      const intersects = raycaster.intersectObjects(manholeSprites);
      document.getElementById('viewport').style.cursor = intersects.length > 0 ? 'pointer' : 'grab';
      return;
    }

    const result = this.raycaster.castRay(event);
    document.getElementById('viewport').style.cursor = result ? 'pointer' : 'default';
  }

  // ── Rest of existing methods (preserved) ──

  async _loadBasemap() {
    // Prefer the optimised JPEG (~3 MB, ≤4096px); fall back to the original PNG.
    const sources = ['basemap.jpg', 'basemap.png'];
    const textureLoader = new THREE.TextureLoader();

    for (const src of sources) {
      try {
        const texture = await new Promise((resolve, reject) => {
          textureLoader.load(
            src,
            (tex) => resolve(tex),
            undefined,
            () => reject(new Error(`Basemap load failed: ${src}`))
          );
        });
        this.basemapMesh = this.geometryBuilder.buildBasemap(texture);
        return;
      } catch (error) {
        // Try the next source before giving up.
      }
    }

    appState.addError('Basemap not loaded — continuing without it', 'Basemap');
    console.warn('Basemap not loaded — continuing without it');
  }

  _yieldFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
  }

  _setupEventListeners() {
    const viewport = document.getElementById('viewport');
    viewport.addEventListener('click', this._onViewportClick);
    viewport.addEventListener('mousemove', this._onViewportMouseMove);
    document.addEventListener('keydown', this._onKeyDown);

    document.querySelector('.logo')?.addEventListener('dblclick', () => {
      const box = this.coordSystem.computeBoundingBox(appState.networkData.manholes);
      this.sceneManager.frameCamera(box, 0.5);
      this._setCameraView('iso');
    });
  }

  _setupUIControls() {
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => this._setCameraView(btn.dataset.view));
    });

    this.ui.setupLayerControls({
      onManholeLayer: (visible) => {
        if (this.geometryBuilder.iCoversSewer) this.geometryBuilder.iCoversSewer.visible = visible;
        if (this.geometryBuilder.iCoversStorm) this.geometryBuilder.iCoversStorm.visible = visible;
        if (this.geometryBuilder.iShafts) this.geometryBuilder.iShafts.visible = visible;
      },
      onPipeLayer: (visible) => {
        const storm = this.sceneManager.scene.getObjectByName('pipes_storm');
        const sewer = this.sceneManager.scene.getObjectByName('pipes_sewer');
        if (storm) storm.visible = visible;
        if (sewer) sewer.visible = visible;
      },
      onBasemapLayer: (visible) => {
        if (this.basemapMesh) this.basemapMesh.visible = visible;
      },
      onGroundLayer: (visible) => {
        if (this.groundObjects.plane) this.groundObjects.plane.visible = visible;
      }
    });

    this.ui.setupSliderControls({
      onElevChange: (offset) => {
        if (this.basemapMesh) {
          const baseElev = appState.networkData?.metadata?.basemap_elev || 1546.83;
          this.basemapMesh.position.y = (baseElev + offset) - this.coordSystem.originElev;
        }
      },
      onOpacityChange: (opacity) => {
        if (this.basemapMesh?.material) {
          this.basemapMesh.material.opacity = opacity / 100;
        }
      }
    });

    this.ui.elements.measureBtn?.addEventListener('click', () => {
      const newMode = !appState.measureMode;
      appState.setMeasureMode(newMode);
      this.ui.setMeasureMode(newMode);
    });
  }

  _setupSearchAndTable() {
    if (!document.getElementById('data-panel')) {
      const panel = document.createElement('div');
      panel.id = 'data-panel';
      panel.innerHTML = `
        <div class="dt-search">
          <input type="text" id="dt-search-input" placeholder="Search ID, name, or type..." autocomplete="off" spellcheck="false">
          <div class="dt-search-hint">Press Enter to select first result · T to toggle panel</div>
        </div>
        <div class="dt-filters">
          <button class="dt-filter-btn active" data-filter="all">All</button>
          <button class="dt-filter-btn sewer" data-filter="Sewer">Sewer</button>
          <button class="dt-filter-btn storm" data-filter="Stormwater">Storm</button>
        </div>
        <div id="dt-table-container" style="flex:1;overflow:hidden;"></div>
      `;
      document.body.appendChild(panel);

      const toggle = document.createElement('button');
      toggle.id = 'data-toggle';
      toggle.innerHTML = '☰';
      toggle.title = 'Toggle data table (T)';
      document.body.appendChild(toggle);

      toggle.addEventListener('click', () => this._toggleDataPanel());

      panel.querySelectorAll('.dt-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          panel.querySelectorAll('.dt-filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this._applyFilter();
        });
      });

      const input = panel.querySelector('#dt-search-input');
      input.addEventListener('input', () => {
        clearTimeout(this._searchDebounceTimer);
        this._searchDebounceTimer = setTimeout(() => this._applyFilter(), 150);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const firstVisible = this.dataTable?.filteredData[0];
          if (firstVisible) {
            this._flyToManhole(firstVisible.index);
            this.dataTable?.setSelectedIndex(firstVisible.index);
          }
        }
      });
    }

    const tableContainer = document.getElementById('dt-table-container');
    if (tableContainer) {
      this.dataTable = new DataTable('dt-table-container', {
        onRowClick: (data) => {
          this._flyToManhole(data.index);
          this.dataTable.setSelectedIndex(data.index);
        }
      });
      this.dataTable.setData(appState.networkData.manholes, this.searchIndex);
    }
  }

  _toggleDataPanel() {
    const panel = document.getElementById('data-panel');
    const toggle = document.getElementById('data-toggle');
    const viewport = document.getElementById('viewport');
    panel?.classList.toggle('visible');
    toggle?.classList.toggle('active', panel?.classList.contains('visible'));
    viewport?.classList.toggle('has-data-panel', panel?.classList.contains('visible'));
  }

  _applyFilter() {
    const input = document.getElementById('dt-search-input');
    const query = input?.value?.trim() || '';
    const activeFilter = document.querySelector('.dt-filter-btn.active');
    const type = activeFilter?.dataset.filter === 'all' ? null : activeFilter?.dataset.filter;

    this._isolateNetworkType(type);

    if (!query) {
      this.dataTable?.filter(type ? d => d.type === type : null);
    } else {
      const indices = this.searchIndex.filterManholes({ type, searchQuery: query });
      const indexSet = new Set(indices);
      this.dataTable?.filter(d => indexSet.has(d.index));
    }
  }

  _isolateNetworkType(type) {
    const showSewerMH = !type || type === 'Sewer';
    const showStormMH = !type || type === 'Stormwater';
    const showSewerPipe = !type || type === 'Sewer';
    const showStormPipe = !type || type === 'Stormwater';

    if (this.geometryBuilder.iCoversSewer) {
      this.geometryBuilder.iCoversSewer.visible = showSewerMH;
    }
    if (this.geometryBuilder.iCoversStorm) {
      this.geometryBuilder.iCoversStorm.visible = showStormMH;
    }

    this._setShaftVisibility(type);

    const stormPipe = this.sceneManager.scene.getObjectByName('pipes_storm');
    const sewerPipe = this.sceneManager.scene.getObjectByName('pipes_sewer');
    if (stormPipe) stormPipe.visible = showStormPipe;
    if (sewerPipe) sewerPipe.visible = showSewerPipe;

    const mhCheckbox = document.getElementById('layer-mh');
    const pipeCheckbox = document.getElementById('layer-pipes');
    if (mhCheckbox) mhCheckbox.checked = true;
    if (pipeCheckbox) pipeCheckbox.checked = true;
  }

  _setShaftVisibility(type) {
    if (!this.geometryBuilder.iShafts) return;

    const dummy = new THREE.Object3D();
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    for (let i = 0; i < appState.mhInstData.length; i++) {
      const mh = appState.mhInstData[i];
      const shouldShow = !type || mh.type === type;

      this.geometryBuilder.iShafts.getMatrixAt(i, matrix);
      matrix.decompose(position, quaternion, scale);

      if (shouldShow) {
        dummy.position.copy(position);
        dummy.quaternion.copy(quaternion);
        dummy.scale.set(mh.r * 2, mh.h, mh.r * 2);
      } else {
        dummy.position.copy(position);
        dummy.quaternion.copy(quaternion);
        dummy.scale.set(0, 0, 0);
      }
      dummy.updateMatrix();
      this.geometryBuilder.iShafts.setMatrixAt(i, dummy.matrix);
    }

    this.geometryBuilder.iShafts.instanceMatrix.needsUpdate = true;
  }

  _setupFlowToggle() {
    const btn = document.getElementById('flow-toggle');
    if (!btn) {
      const newBtn = document.createElement('button');
      newBtn.id = 'flow-toggle';
      newBtn.textContent = 'Toggle Flow Direction';
      newBtn.title = 'Toggle flow direction (F)';
      document.body.appendChild(newBtn);

      newBtn.addEventListener('click', () => {
        const on = this.flowArrows?.toggle();
        this._flowOn = !!on;
        this._applyFlowVisibility();   // arrows + animated ribbons
        newBtn.textContent = on ? 'Hide Flow Direction' : 'Toggle Flow Direction';
        newBtn.classList.toggle('active', on);
      });
    } else {
      btn.addEventListener('click', () => {
        const on = this.flowArrows?.toggle();
        this._flowOn = !!on;
        this._applyFlowVisibility();
        btn.textContent = on ? 'Hide Flow Direction' : 'Toggle Flow Direction';
        btn.classList.toggle('active', on);
      });
    }
  }

  _setupHelpModal() {
    // Optional guided walkthrough (welcome card + spotlight tour).
    this.helpModal = new Walkthrough();
    setTimeout(() => this.helpModal.maybeAutoShowWelcome(), 700);
  }

  _flyToManhole(index) {
    const mh = appState.mhInstData[index];
    if (!mh) return;

    appState.clearSelection();
    this.geometryBuilder.resetManholeColors();
    this.geometryBuilder.clearPipeHighlight();

    this.geometryBuilder.setManholeColor(index, this.geometryBuilder.COL_HOVER);
    const highlight = this.geometryBuilder.createManholeHighlight(mh);
    this.sceneManager.scene.add(highlight);
    appState.setSelection('manhole', index, highlight);

    const target = mh.topS.clone();
    const offset = new THREE.Vector3(18, 14, 18);
    const camPos = target.clone().add(offset);
    this.sceneManager.animateCamera(camPos, target, 700);

    this.ui.renderManholePopup(mh);
    this.dataTable?.setSelectedIndex(index);
  }

  _selectManhole(idx) {
    const mh = appState.mhInstData[idx];
    if (!mh) return;

    this.geometryBuilder.resetManholeColors();
    this.geometryBuilder.clearPipeHighlight();
    this.geometryBuilder.setManholeColor(idx, this.geometryBuilder.COL_HOVER);

    const highlight = this.geometryBuilder.createManholeHighlight(mh);
    this.sceneManager.scene.add(highlight);
    appState.setSelection('manhole', idx, highlight);

    this.ui.renderManholePopup(mh);
    this.dataTable?.setSelectedIndex(idx);
  }

  _selectPipe(idx) {
    const pd = appState.pipeData[idx];
    if (!pd) return;

    this.geometryBuilder.resetManholeColors();
    const highlight = this.geometryBuilder.setPipeHighlight(idx);
    appState.setSelection('pipe', idx, highlight);

    if (pd.fromIdx >= 0) {
      this.geometryBuilder.setManholeColor(pd.fromIdx, this.geometryBuilder.COL_PIPE_MH);
      const glow = this.geometryBuilder.createConnectedHighlight(appState.mhInstData[pd.fromIdx]);
      this.sceneManager.scene.add(glow);
      appState.addConnectedHighlight(glow);
    }
    if (pd.toIdx >= 0) {
      this.geometryBuilder.setManholeColor(pd.toIdx, this.geometryBuilder.COL_PIPE_MH);
      const glow = this.geometryBuilder.createConnectedHighlight(appState.mhInstData[pd.toIdx]);
      this.sceneManager.scene.add(glow);
      appState.addConnectedHighlight(glow);
    }

    this.ui.renderPipePopup(pd, (pipeData) => {
      this.ui.showProfile();
      this.ui.drawProfile(pipeData);
    });
  }

  _onMeasureClick(event) {
    const targets = [this.groundObjects.plane, this.basemapMesh].filter(Boolean);
    const point = this.raycaster.castRayToGround(event, targets);
    if (!point) return;

    const marker = this.geometryBuilder.createMeasureMarker(point);
    this.sceneManager.scene.add(marker);
    appState.addMeasurePoint(point, marker);

    const points = appState.measurePoints;
    if (points.length === 1) {
      this.ui.setMeasureResult('Click second point...');
    } else if (points.length === 2) {
      const dist = points[0].distanceTo(points[1]);
      this.ui.setMeasureResult(`Distance: <span style="font-size:18px;">${dist.toFixed(2)} m</span>`);
      setTimeout(() => appState.clearMeasurePoints(), 3000);
    }
  }

  _onKeyDown(event) {
    if (event.target.tagName === 'INPUT') return;

    switch (event.key.toLowerCase()) {
      case '1': if (!this.mapMode) this._setCameraView('iso'); break;
      case '2': if (!this.mapMode) this._setCameraView('top'); break;
      case '3': if (!this.mapMode) this._setCameraView('front'); break;
      case '4': if (!this.mapMode) this._setCameraView('right'); break;
      case '5': if (!this.mapMode) this._setCameraView('left'); break;
      case '6': if (!this.mapMode) this._setCameraView('back'); break;
      // case 'm':
      //   if (!this.mapMode) this.ui.elements.measureBtn?.click();
      //   break;
      case 'f':
        document.getElementById('flow-toggle')?.click();
        break;
      // case 't':
      //   if (!this.mapMode) this._toggleDataPanel();
      //   break;
      // case 'v':
      //   this._toggleMapMode();
      //   break;
      case '?':
        this.helpModal?.toggle();
        break;
      case 'escape':
        if (appState.measureMode) this.ui.elements.measureBtn?.click();
        this.ui.hidePopup();
        this.ui.hideProfile();
        appState.clearSelection();
        this.geometryBuilder.resetManholeColors();
        this.geometryBuilder.clearPipeHighlight();
        if (this.mapMode) {
          this._clearMapHighlights();
          this.mapSelectedManhole = null;
          this._hideMapPopup();
        }
        break;
    }
  }

  _setCameraView(viewName) {
    const box = this.coordSystem.computeBoundingBox(appState.networkData.manholes);
    const targetPos = this.sceneManager.getViewPosition(viewName, box);
    const centre = new THREE.Vector3();
    box.getCenter(centre);

    this.sceneManager.animateCamera(targetPos, centre, 800);
    appState.setCurrentView(viewName);
    this.ui.setActiveView(viewName);
  }

  _animate() {
    requestAnimationFrame(this._animate);
    this.sceneManager.controls.update();

    if (!this.mapMode) {
      this.flowArrows?.update(this.sceneManager.camera);
      this._updateZoomScaling();  // Dynamic scaling for arrows and symbols

      const droplines = this.sceneManager.scene.getObjectByName('droplines');
      if (droplines) {
        const dist = this.sceneManager.camera.position.distanceTo(this.sceneManager.controls.target);
        droplines.visible = dist < 300;
      }
    } else {
      // Scale map sprites for constant screen size + declutter labels
      this._updateMapSpriteZoom();
      // March the animated flow chevrons along each pipe
      this._animateFlowRibbons();
    }

    this.sceneManager.render();
    this.ui.updateFPS();
  }

  /**
   * Dynamic scaling for 3D view: as camera zooms in (gets closer), arrows and
   * symbols get smaller (but never vanishingly small) so they don't overlap and
   * block detail. As you zoom out, they get larger for visibility.
   *
   * Scaling formula: base scale × (1 / sqrt(cameraDistance))
   * This gives a gentle non-linear scaling: at 100m scale=1.0, at 10m scale≈0.3
   */
  _updateZoomScaling() {
    if (!this.sceneManager || !this.sceneManager.camera) return;

    const camera = this.sceneManager.camera;
    const target = this.sceneManager.controls?.target || new THREE.Vector3(0, 0, 0);
    const dist = camera.position.distanceTo(target);

    // Scale factor based on distance: gets smaller as you zoom in (smaller dist = smaller scale)
    // Using sqrt for gentler scaling; clamp to 0.2–1.5 range to avoid extremes
    const scaleFactor = Math.max(0.2, Math.min(1.5, Math.sqrt(dist / 100)));

    // Scale flow arrows via dedicated method (handles InstancedMesh properly)
    this.flowArrows?.setZoomScale(scaleFactor);

    // Scale manhole symbols (the cylinder-covers in 3D)
    if (this.sceneManager.geometryBuilder?.iCoversSewer) {
      this.sceneManager.geometryBuilder.iCoversSewer.scale.setScalar(scaleFactor);
    }
    if (this.sceneManager.geometryBuilder?.iCoversStorm) {
      this.sceneManager.geometryBuilder.iCoversStorm.scale.setScalar(scaleFactor);
    }
  }

  /**
   * Keep manhole sprites at a consistent screen size regardless of orthographic zoom.
   * OrbitControls changes OrthographicCamera.zoom (1 = default, >1 = zoomed in).
   * We divide the base world-scale by zoom so sprites shrink as you zoom in.
   */
  _updateMapSpriteZoom() {
    if (!this.mapCamera || !this.mapManholeSprites.length) return;

    const zoom = this.mapCamera.zoom || 1;
    // Gentle scaling: sprites shrink slowly as you zoom in.
    // Uses sqrt so zoom=4 only halves the size instead of quartering it.
    const scaleFactor = 1 / Math.sqrt(Math.max(zoom, 0.25));

    for (const sprite of this.mapManholeSprites) {
      if (!sprite.visible || !sprite.userData.baseScale) continue;
      const base = sprite.userData.baseScale;
      sprite.scale.set(base.x * scaleFactor, base.y * scaleFactor, base.z);
    }
  }

  /**
   * Build a 64×64 chevron canvas (">" pointing toward +U). A fresh CanvasTexture
   * is created per pipe from this shared canvas, then repeated/scrolled to animate.
   */
  _makeChevronCanvas() {
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const chevron = (color, lw) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(22, 14);
      ctx.lineTo(46, 32);
      ctx.lineTo(22, 50);
      ctx.stroke();
    };
    chevron('rgba(13,30,53,0.95)', 17);    // dark halo for contrast on any pipe
    chevron('rgba(255,255,255,0.98)', 9);  // bright white core
    return cv;
  }

  /** Scroll each visible flow ribbon's texture so the chevrons march downstream. */
  _animateFlowRibbons() {
    if (!this.mapFlowRibbons.length) return;
    const now = performance.now();
    const dt = this._flowLastT ? Math.min((now - this._flowLastT) / 1000, 0.1) : 0;
    this._flowLastT = now;
    const speed = 0.45;   // texture tiles per second (≈ 0.45 × 4 m ≈ 1.8 m/s)
    for (const r of this.mapFlowRibbons) {
      if (!r.mesh.visible) continue;
      r.tex.offset.x = (r.tex.offset.x - speed * dt) % 1;
    }
  }

  /** Apply flow visibility: a flow arrow/ribbon shows only if flow is on AND its
   *  pipe type is currently visible. Single source of truth for both. */
  _applyFlowVisibility() {
    const typeOn = (storm) => (storm ? this._stormOn : this._sewerOn);
    this.mapFlowArrows.forEach(a => {
      a.visible = this._flowOn && typeOn(a.userData?.isStormwater);
    });
    this.mapFlowRibbons.forEach(r => {
      r.mesh.visible = this._flowOn && typeOn(r.isStormwater);
    });
  }

  _handleFatalError(error) {
    console.error('Fatal error:', error);
    appState.addError(error.message, 'App.init');
    this.ui.setProgress(0, 'Error');

    const loading = document.getElementById('loading');
    if (loading) {
      loading.innerHTML = `
        <div style="color:#E74C3C; font-family:monospace; text-align:center;">
          <h3>⚠ Application Error</h3>
          <p>${error.message}</p>
          <p style="font-size:11px; color:#8BA3BC;">Check browser console</p>
        </div>
      `;
    }
  }
}

const app = new NetworkViewerApp();
app.init().catch(err => console.error('Unhandled init error:', err));
