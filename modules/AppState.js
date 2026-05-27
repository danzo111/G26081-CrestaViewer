/**
 * AppState.js — Centralized Application State Manager
 * 
 * Eliminates global variable soup by encapsulating all mutable state
 * into a single predictable, observable class.
 */

export class AppState {
  constructor() {
    this._selectedType = null;
    this._selectedIndex = null;
    this._highlightMesh = null;
    this._connectedHighlights = [];

    this._measureMode = false;
    this._measurePoints = [];
    this._measureMarkers = [];

    this._currentView = 'iso';

    this._scene = null;
    this._renderer = null;
    this._camera = null;
    this._controls = null;

    this._networkData = null;
    this._mhLookup = null;
    this._mhInstData = [];
    this._pipeData = [];

    this._errors = [];
    this._errorListeners = [];

    this._loading = true;
    this._loadProgress = 0;
    this._loadMessage = 'INITIALISING...';
  }

  get selectedType() { return this._selectedType; }
  get selectedIndex() { return this._selectedIndex; }
  get highlightMesh() { return this._highlightMesh; }
  get connectedHighlights() { return this._connectedHighlights; }
  get measureMode() { return this._measureMode; }
  get measurePoints() { return this._measurePoints; }
  get measureMarkers() { return this._measureMarkers; }
  get currentView() { return this._currentView; }
  get scene() { return this._scene; }
  get renderer() { return this._renderer; }
  get camera() { return this._camera; }
  get controls() { return this._controls; }
  get networkData() { return this._networkData; }
  get mhLookup() { return this._mhLookup; }
  get mhInstData() { return this._mhInstData; }
  get pipeData() { return this._pipeData; }
  get errors() { return [...this._errors]; }
  get loading() { return this._loading; }
  get loadProgress() { return this._loadProgress; }
  get loadMessage() { return this._loadMessage; }

  setScene(scene) { this._scene = scene; }
  setRenderer(renderer) { this._renderer = renderer; }
  setCamera(camera) { this._camera = camera; }
  setControls(controls) { this._controls = controls; }

  setNetworkData(data) {
    this._networkData = data;
    this._mhLookup = {};
    if (data && data.manholes) {
      data.manholes.forEach(m => { this._mhLookup[m.id] = m; });
    }
  }

  setMhInstData(data) { this._mhInstData = data; }
  setPipeData(data) { this._pipeData = data; }

  setSelection(type, index, highlightMesh = null) {
    this.clearSelection();
    this._selectedType = type;
    this._selectedIndex = index;
    this._highlightMesh = highlightMesh;
  }

  clearSelection() {
    if (this._highlightMesh) {
      this._scene?.remove(this._highlightMesh);
      this._highlightMesh.geometry?.dispose();
      this._highlightMesh = null;
    }

    this._connectedHighlights.forEach(m => {
      this._scene?.remove(m);
      m.geometry?.dispose();
    });
    this._connectedHighlights = [];

    this._selectedType = null;
    this._selectedIndex = null;
  }

  addConnectedHighlight(mesh) {
    this._connectedHighlights.push(mesh);
  }

  setMeasureMode(active) {
    this._measureMode = active;
    if (!active) {
      this.clearMeasurePoints();
    }
  }

  addMeasurePoint(point, marker) {
    this._measurePoints.push(point);
    this._measureMarkers.push(marker);
  }

  clearMeasurePoints() {
    this._measureMarkers.forEach(m => this._scene?.remove(m));
    this._measurePoints = [];
    this._measureMarkers = [];
  }

  setCurrentView(view) { this._currentView = view; }

  addError(message, source = 'unknown') {
    const error = { message, source, timestamp: new Date().toISOString() };
    this._errors.push(error);
    console.error(`[${source}] ${message}`);
    this._notifyErrorListeners(error);
  }

  onError(callback) {
    this._errorListeners.push(callback);
  }

  _notifyErrorListeners(error) {
    this._errorListeners.forEach(cb => {
      try { cb(error); } catch (e) { console.error('Error in error listener:', e); }
    });
  }

  clearErrors() { this._errors = []; }

  setLoading(loading) { this._loading = loading; }
  setLoadProgress(pct) { this._loadProgress = pct; }
  setLoadMessage(msg) { this._loadMessage = msg; }

  validateData() {
    const issues = [];

    if (!this._networkData) {
      issues.push('No network data loaded');
      return issues;
    }

    if (!this._networkData.manholes || this._networkData.manholes.length === 0) {
      issues.push('No manholes in dataset');
    }

    if (!this._networkData.pipes || this._networkData.pipes.length === 0) {
      issues.push('No pipes in dataset');
    }

    this._networkData.pipes.forEach((pipe, i) => {
      if (!this._mhLookup[pipe.from_mh]) {
        issues.push(`Pipe ${pipe.id || i}: missing from_mh "${pipe.from_mh}"`);
      }
      if (!this._mhLookup[pipe.to_mh]) {
        issues.push(`Pipe ${pipe.id || i}: missing to_mh "${pipe.to_mh}"`);
      }
    });

    return issues;
  }
}

export const appState = new AppState();
