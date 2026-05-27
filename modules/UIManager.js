/**
 * UIManager.js — UI Controllers, Popups & Panels
 * 
 * Handles all DOM manipulation, event wiring, popup rendering,
 * elevation profile drawing, and measure tool UI.
 */

import { appState } from './AppState.js';

export class UIManager {
  constructor() {
    this.elements = {};
    this._cacheElements();
    this._setupEventListeners();

    this.frameCount = 0;
    this.lastTime = performance.now();
  }

  _cacheElements() {
    this.elements = {
      loading: document.getElementById('loading'),
      loadLabel: document.getElementById('load-label'),
      loadBar: document.getElementById('load-bar'),
      statsLabel: document.getElementById('stats-label'),
      crsLabel: document.getElementById('crs-label'),
      popup: document.getElementById('popup'),
      popupType: document.getElementById('popup-type'),
      popupTitle: document.getElementById('popup-title'),
      popupBody: document.getElementById('popup-body'),
      popupClose: document.getElementById('popup-close'),
      profilePanel: document.getElementById('profile-panel'),
      profileCanvas: document.getElementById('profile-canvas'),
      profileStats: document.getElementById('profile-stats'),
      profileClose: document.getElementById('profile-close'),
      measurePanel: document.getElementById('measure-panel'),
      measureResult: document.getElementById('measure-result'),
      measureClose: document.getElementById('measure-close'),
      measureBtn: document.getElementById('measure-btn'),
      viewButtons: document.querySelectorAll('.view-btn'),
      errorBanner: document.getElementById('error-banner'),

      layerMH: document.getElementById('layer-mh'),
      layerPipes: document.getElementById('layer-pipes'),
      layerBasemap: document.getElementById('layer-basemap'),
      layerGround: document.getElementById('layer-ground'),

      elevSlider: document.getElementById('elev-slider'),
      elevDisplay: document.getElementById('elev-display'),
      elevAbs: document.getElementById('elev-abs'),
      opacitySlider: document.getElementById('opacity-slider'),
      opacityDisplay: document.getElementById('opacity-display')
    };

    // Warn about missing elements
    Object.entries(this.elements).forEach(([key, el]) => {
      if (!el && key !== 'errorBanner') {
        console.warn(`UIManager: element "${key}" not found in DOM`);
      }
    });
  }

  _setupEventListeners() {
    this.elements.popupClose?.addEventListener('click', () => this.hidePopup());
    this.elements.profileClose?.addEventListener('click', () => this.hideProfile());
    this.elements.measureClose?.addEventListener('click', () => {
      this.elements.measureBtn?.click();
    });

    document.querySelector('.error-close')?.addEventListener('click', () => {
      this.elements.errorBanner?.classList.remove('visible');
    });

    appState.onError((error) => {
      this.showErrorBanner(error.message);
    });
  }

  // ── Loading Screen ─────────────────────────────────────────
  setProgress(pct, msg) {
    if (this.elements.loadBar) {
      this.elements.loadBar.style.width = pct + '%';
    }
    if (this.elements.loadLabel) {
      this.elements.loadLabel.textContent = (msg || '').toUpperCase();
    }
    appState.setLoadProgress(pct);
    appState.setLoadMessage(msg);
  }

  hideLoading() {
    this.elements.loading?.classList.add('hidden');
    appState.setLoading(false);
  }

  // ── Error Banner ───────────────────────────────────────────
  showErrorBanner(message) {
    if (!this.elements.errorBanner) {
      console.error('Error (no banner):', message);
      return;
    }

    const errorText = this.elements.errorBanner.querySelector('.error-text');
    if (errorText) errorText.textContent = message;

    this.elements.errorBanner.classList.add('visible');

    setTimeout(() => {
      this.elements.errorBanner?.classList.remove('visible');
    }, 8000);
  }

  // ── Stats ──────────────────────────────────────────────────
  updateStats(mhCount, pipeCount, fps = null) {
    let text = `${mhCount} MH · ${pipeCount} Pipes`;
    if (fps !== null) text += ` · ${fps} FPS`;
    if (this.elements.statsLabel) {
      this.elements.statsLabel.textContent = text;
    }
  }

  updateFPS() {
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastTime > 2000) {
      const fps = Math.round(this.frameCount * 1000 / (now - this.lastTime));
      this.updateStats(
        appState.networkData?.manholes?.length || 0,
        appState.networkData?.pipes?.length || 0,
        fps
      );
      this.frameCount = 0;
      this.lastTime = now;
    }
  }

  setCRSLabel(text) {
    if (this.elements.crsLabel) {
      this.elements.crsLabel.textContent = `CRS: ${text}`;
    }
  }

  // ── Popup ──────────────────────────────────────────────────
  showPopup(screenPos = null) {
    if (!this.elements.popup) {
      console.error('showPopup: popup element not found');
      return;
    }
    this.elements.popup.classList.add('visible');
    this.elements.popup.style.pointerEvents = 'auto';

    // Always position on the right side for map view
    this.elements.popup.style.left = 'auto';
    this.elements.popup.style.right = '20px';
    this.elements.popup.style.top = '60px';
    this.elements.popup.style.maxHeight = 'calc(100vh - 80px)';
    this.elements.popup.style.overflowY = 'auto';
  }

  hidePopup() {
    this.elements.popup?.classList.remove('visible');
    if (this.elements.popup) {
      this.elements.popup.style.pointerEvents = 'none';
    }
  }

  renderManholePopup(mh, traceInfo = null, screenPos = null) {
    if (!this.elements.popupType || !this.elements.popupTitle || !this.elements.popupBody) {
      console.error('renderManholePopup: missing popup elements');
      return;
    }

    this.elements.popupType.className = 'type-tag manhole';
    this.elements.popupType.textContent = (mh.type || 'MANHOLE').toUpperCase();
    this.elements.popupTitle.textContent = mh.name || 'Unknown';

    let html = '';
    html += this._row('Cover Elev.', `${(mh.cover_elev || 0).toFixed(2)} m`, 'accent');
    html += this._row('Invert Elev.', `${(mh.invertElev || 0).toFixed(2)} m`);
    html += this._row('Depth', 
      mh.depth === 0.33 ? "Can't Measure" : `${Math.max(mh.depth || 0, 0).toFixed(2)} m`, 
      'amber'
    );
    html += this._row('Y (m)', ((mh.x || 0)).toFixed(2));
    html += this._row('X (m)', ((mh.y || 0)).toFixed(2));

    if (mh.images && mh.images.length > 0) {
      html += this._buildImageGallery(mh.images, mh.name);
    }

    // Network trace legend — explains what green/red means
    if (traceInfo) {
      html += `
        <div class="trace-legend">
          <div class="trace-legend-title">⬡ Network Trace</div>
          <div class="trace-legend-row">
            <span class="trace-dot up"></span>
            <span class="trace-text"><strong>Upstream</strong> — water flows TO this manhole</span>
            <span class="trace-count">${traceInfo.upstreamCount} MH · ${traceInfo.upstreamPipeCount} pipes</span>
          </div>
          <div class="trace-legend-row">
            <span class="trace-dot down"></span>
            <span class="trace-text"><strong>Downstream</strong> — water flows FROM this manhole</span>
            <span class="trace-count">${traceInfo.downstreamCount} MH · ${traceInfo.downstreamPipeCount} pipes</span>
          </div>
          <div class="trace-legend-note">
            💡 <em>Green = where water comes from · Red = where water goes</em>
          </div>
        </div>
      `;
    }

    this.elements.popupBody.innerHTML = html;
    this.showPopup(screenPos);

    requestAnimationFrame(() => this._attachGalleryListeners());
  }

  renderPipePopup(pd, onProfileClick, screenPos = null) {
    if (!this.elements.popupType || !this.elements.popupTitle || !this.elements.popupBody) {
      console.error('renderPipePopup: missing popup elements');
      return;
    }

    this.elements.popupType.className = 'type-tag pipe';
    this.elements.popupType.textContent = 'PIPE';
    this.elements.popupTitle.textContent = pd.id || 'Unknown';

    let html = '';
    html += this._row('Diameter', `${pd.diameter_mm || 0} mm`, 'amber');
    html += this._row('From', pd.fromMH?.name || 'Unknown', 'accent');
    html += this._row('To', pd.toMH?.name || 'Unknown', 'accent');
    html += this._row('Upstream Inv.', `${(pd.fromInvert || 0).toFixed(3)} m`, 'green');
    html += this._row('Downstream Inv.', `${(pd.toInvert || 0).toFixed(3)} m`, 'green');
    html += this._row('Length', `${(pd.length || 0).toFixed(2)} m`);
    html += this._row('Grade', 
      `${(pd.grade > 0 ? '+' : '')}${(pd.grade || 0).toFixed(2)} %`,
      (pd.grade || 0) >= 0 ? 'green' : 'red'
    );
    html += `<button class="profile-btn" id="profile-btn">📊 &nbsp;ELEVATION PROFILE</button>`;

    this.elements.popupBody.innerHTML = html;
    this.showPopup(screenPos);

    requestAnimationFrame(() => {
      const btn = document.getElementById('profile-btn');
      if (btn) btn.addEventListener('click', () => onProfileClick(pd));
    });
  }

  /**
   * Render pipe popup with embedded elevation profile for Map View.
   * Draws the profile chart directly into the popup body instead of a separate panel.
   */
  renderPipePopupWithProfile(pd, screenPos = null) {
    if (!this.elements.popupType || !this.elements.popupTitle || !this.elements.popupBody) {
      console.error('renderPipePopupWithProfile: missing popup elements');
      return;
    }

    this.elements.popupType.className = 'type-tag pipe';
    this.elements.popupType.textContent = 'PIPE';
    this.elements.popupTitle.textContent = pd.id || 'Unknown';

    let html = '';
    html += this._row('Diameter', `${pd.diameter_mm || 0} mm`, 'amber');
    html += this._row('From', pd.fromMH?.name || 'Unknown', 'accent');
    html += this._row('To', pd.toMH?.name || 'Unknown', 'accent');
    html += this._row('Upstream Inv.', `${(pd.fromInvert || 0).toFixed(3)} m`, 'green');
    html += this._row('Downstream Inv.', `${(pd.toInvert || 0).toFixed(3)} m`, 'green');
    html += this._row('Length', `${(pd.length || 0).toFixed(2)} m`);
    html += this._row('Grade', 
      `${(pd.grade > 0 ? '+' : '')}${(pd.grade || 0).toFixed(2)} %`,
      (pd.grade || 0) >= 0 ? 'green' : 'red'
    );

    // Add elevation profile section directly in popup
    html += `<div style="margin: 12px 20px 8px; padding: 10px; background: var(--dark); border: 1px solid var(--border-mid); border-radius: var(--radius);">
      <div style="font-family: var(--mono); font-size: 14px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--accent); margin-bottom: 8px; font-weight: 700;">📊 Elevation Profile</div>
      <canvas id="popup-profile-canvas" width="420" height="220" style="width: 100%; display: block; border-radius: var(--radius);"></canvas>
      <div id="popup-profile-stats" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--border-faint); margin-top: 8px; border-top: 1px solid var(--border-faint);"></div>
    </div>`;

    this.elements.popupBody.innerHTML = html;
    this.showPopup(screenPos);

    // Draw the profile on the embedded canvas
    requestAnimationFrame(() => {
      this._drawProfileOnCanvas(pd, 'popup-profile-canvas', 'popup-profile-stats');
    });
  }

  /**
   * Draw elevation profile on a specified canvas element.
   * @param {Object} pd - Pipe data
   * @param {string} canvasId - Canvas element ID
   * @param {string} statsId - Stats container ID (optional)
   */
  _drawProfileOnCanvas(pd, canvasId, statsId = null) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const PAD = { top: 25, right: 15, bottom: 35, left: 50 };

    // Clear with dark background
    ctx.fillStyle = '#162B47';
    ctx.fillRect(0, 0, W, H);
    ctx.clearRect(0, 0, W, H);

    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;

    const fromElev = pd.fromInvert || 0;
    const toElev = pd.toInvert || 0;
    const fromCover = pd.fromMH?.cover_elev || 0;
    const toCover = pd.toMH?.cover_elev || 0;
    const minElev = Math.min(fromElev, toElev, fromCover, toCover) - 0.5;
    const maxElev = Math.max(fromElev, toElev, fromCover, toCover) + 0.5;
    const elevRange = maxElev - minElev || 1;

    const toChartX = (dist) => PAD.left + (dist / (pd.length || 1)) * chartW;
    const toChartY = (elev) => PAD.top + chartH - ((elev - minElev) / elevRange) * chartH;

    // Grid
    ctx.strokeStyle = 'rgba(212,180,131,0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    const step = elevRange > 5 ? 1 : 0.5;
    for (let e = Math.ceil(minElev / step) * step; e <= maxElev; e += step) {
      const y = toChartY(e);
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + chartW, y);
      ctx.stroke();

      ctx.fillStyle = '#D4B483';
      ctx.font = '11px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(e.toFixed(1), PAD.left - 6, y + 3);
    }
    ctx.setLineDash([]);

    // Ground surface
    ctx.fillStyle = 'rgba(212,136,15,0.08)';
    ctx.strokeStyle = 'rgba(212,136,15,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(toChartX(0), toChartY(fromCover));
    ctx.lineTo(toChartX(pd.length || 1), toChartY(toCover));
    ctx.lineTo(toChartX(pd.length || 1), toChartY(minElev));
    ctx.lineTo(toChartX(0), toChartY(minElev));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Pipe invert
    ctx.strokeStyle = '#D4880F';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(toChartX(0), toChartY(fromElev));
    ctx.lineTo(toChartX(pd.length || 1), toChartY(toElev));
    ctx.stroke();

    // Pipe fill
    ctx.fillStyle = 'rgba(212,136,15,0.15)';
    ctx.beginPath();
    ctx.moveTo(toChartX(0), toChartY(fromElev));
    ctx.lineTo(toChartX(pd.length || 1), toChartY(toElev));
    ctx.lineTo(toChartX(pd.length || 1), toChartY(toCover));
    ctx.lineTo(toChartX(0), toChartY(fromCover));
    ctx.closePath();
    ctx.fill();

    // Endpoints
    this._drawPoint(ctx, toChartX(0), toChartY(fromElev), '#f0a500', pd.fromMH?.name || 'From', '#FFFFFF');
    this._drawPoint(ctx, toChartX(pd.length || 1), toChartY(toElev), '#f0a500', pd.toMH?.name || 'To', '#FFFFFF');

    // Cover points
    ctx.fillStyle = 'rgba(0,200,255,0.5)';
    ctx.beginPath();
    ctx.arc(toChartX(0), toChartY(fromCover), 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(toChartX(pd.length || 1), toChartY(toCover), 3, 0, Math.PI * 2);
    ctx.fill();

    // Labels
    ctx.fillStyle = '#D4B483';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('DISTANCE (m)', PAD.left + chartW / 2, H - 8);

    ctx.save();
    ctx.translate(12, PAD.top + chartH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('ELEVATION (m)', 0, 0);
    ctx.restore();

    // Distance ticks
    ctx.strokeStyle = '#D4B483';
    ctx.fillStyle = '#D4B483';
    const distStep = (pd.length || 1) > 50 ? 10 : ((pd.length || 1) > 20 ? 5 : 1);
    for (let d = 0; d <= (pd.length || 1); d += distStep) {
      const x = toChartX(d);
      ctx.beginPath();
      ctx.moveTo(x, PAD.top + chartH);
      ctx.lineTo(x, PAD.top + chartH + 4);
      ctx.stroke();
      ctx.fillText(d.toFixed(0), x, PAD.top + chartH + 16);
    }

    // Title
    ctx.fillStyle = '#1C3557';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Pipe ${pd.id || '?'} — ${pd.diameter_mm || 0} mm`, PAD.left, 16);

    // Grade arrow
    const midX = toChartX((pd.length || 1) / 2);
    const midY = toChartY((fromElev + toElev) / 2);
    ctx.fillStyle = (pd.grade || 0) >= 0 ? '#2E8B57' : '#C0392B';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    const gradeText = `${(pd.grade || 0) >= 0 ? '▲ ' : '▼ '}${Math.abs(pd.grade || 0).toFixed(2)}%`;
    ctx.fillText(gradeText, midX, midY - 8);

    // Stats
    if (statsId) {
      const statsEl = document.getElementById(statsId);
      if (statsEl) {
        const gradeClass = (pd.grade || 0) >= 0 ? 'up' : 'down';
        const gradeArrow = (pd.grade || 0) >= 0 ? '▲' : '▼';
        statsEl.innerHTML = `
          <div class="profile-stat" style="padding: 7px 12px; background: var(--mid);"><div class="profile-stat-label" style="font-family: var(--mono); font-size: 10px; letter-spacing: 0.5px; color: var(--text-faint); text-transform: uppercase; margin-bottom: 2px;">Length</div><div class="profile-stat-value" style="font-family: var(--mono); font-size: 13px; color: var(--text);">${(pd.length || 0).toFixed(2)} m</div></div>
          <div class="profile-stat" style="padding: 7px 12px; background: var(--mid);"><div class="profile-stat-label" style="font-family: var(--mono); font-size: 10px; letter-spacing: 0.5px; color: var(--text-faint); text-transform: uppercase; margin-bottom: 2px;">Diameter</div><div class="profile-stat-value" style="font-family: var(--mono); font-size: 13px; color: var(--text);">${pd.diameter_mm || 0} mm</div></div>
          <div class="profile-stat" style="padding: 7px 12px; background: var(--mid);"><div class="profile-stat-label" style="font-family: var(--mono); font-size: 10px; letter-spacing: 0.5px; color: var(--text-faint); text-transform: uppercase; margin-bottom: 2px;">Grade</div><div class="profile-stat-value ${gradeClass}" style="font-family: var(--mono); font-size: 13px; color: var(--text);">${gradeArrow} ${Math.abs(pd.grade || 0).toFixed(2)}%</div></div>
          <div class="profile-stat" style="padding: 7px 12px; background: var(--mid);"><div class="profile-stat-label" style="font-family: var(--mono); font-size: 10px; letter-spacing: 0.5px; color: var(--text-faint); text-transform: uppercase; margin-bottom: 2px;">Fall / Rise</div><div class="profile-stat-value ${gradeClass}" style="font-family: var(--mono); font-size: 13px; color: var(--text);">${((pd.toInvert || 0) - (pd.fromInvert || 0)).toFixed(3)} m</div></div>
          <div class="profile-stat" style="padding: 7px 12px; background: var(--mid);"><div class="profile-stat-label" style="font-family: var(--mono); font-size: 10px; letter-spacing: 0.5px; color: var(--text-faint); text-transform: uppercase; margin-bottom: 2px;">Upstream</div><div class="profile-stat-value" style="font-family: var(--mono); font-size: 13px; color: var(--text);">${pd.fromMH?.name || '?'}</div></div>
          <div class="profile-stat" style="padding: 7px 12px; background: var(--mid);"><div class="profile-stat-label" style="font-family: var(--mono); font-size: 10px; letter-spacing: 0.5px; color: var(--text-faint); text-transform: uppercase; margin-bottom: 2px;">Downstream</div><div class="profile-stat-value" style="font-family: var(--mono); font-size: 13px; color: var(--text);">${pd.toMH?.name || '?'}</div></div>
          <div class="profile-stat" style="padding: 7px 12px; background: var(--mid);"><div class="profile-stat-label" style="font-family: var(--mono); font-size: 10px; letter-spacing: 0.5px; color: var(--text-faint); text-transform: uppercase; margin-bottom: 2px;">Up. Invert</div><div class="profile-stat-value" style="font-family: var(--mono); font-size: 13px; color: var(--text);">${(pd.fromInvert || 0).toFixed(3)} m</div></div>
          <div class="profile-stat" style="padding: 7px 12px; background: var(--mid);"><div class="profile-stat-label" style="font-family: var(--mono); font-size: 10px; letter-spacing: 0.5px; color: var(--text-faint); text-transform: uppercase; margin-bottom: 2px;">Down. Invert</div><div class="profile-stat-value" style="font-family: var(--mono); font-size: 13px; color: var(--text);">${(pd.toInvert || 0).toFixed(3)} m</div></div>
        `;
      }
    }
  }


  _row(label, val, cls) {
    return `<div class="popup-row"><span class="popup-label">${label}</span><span class="popup-value${cls ? ' ' + cls : ''}">${val}</span></div>`;
  }

  _buildImageGallery(images, mhName) {
    if (!images || images.length === 0) return '';

    const dots = images.map((_, i) => 
      `<div class="img-dot ${i === 0 ? 'active' : ''}" data-idx="${i}"></div>`
    ).join('');

    const items = images.map((img, i) => `
      <div class="img-item">
        <img src="${img}" alt="${mhName} photo ${i + 1}" 
          onerror="this.style.display='none'; this.parentElement.innerHTML='<span style=\'color:#4a6278;font-size:16px;\'>Image not found</span>'">
        <div class="img-label">${mhName}(${i + 1})</div>
      </div>
    `).join('');

    return `
      <div class="img-gallery">
        <div class="img-scroll" id="img-scroll">${items}</div>
        <div class="img-dots">${dots}</div>
      </div>
    `;
  }

  _attachGalleryListeners() {
    const scroll = document.getElementById('img-scroll');
    const dots = document.querySelectorAll('.img-dot');
    if (!scroll || dots.length === 0) return;

    dots.forEach(dot => {
      dot.addEventListener('click', () => {
        const idx = parseInt(dot.dataset.idx);
        const itemWidth = scroll.clientWidth;
        scroll.scrollTo({ left: idx * itemWidth, behavior: 'smooth' });
        dots.forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
      });
    });

    scroll.addEventListener('scroll', () => {
      const itemWidth = scroll.clientWidth;
      const idx = Math.round(scroll.scrollLeft / itemWidth);
      dots.forEach(d => d.classList.remove('active'));
      if (dots[idx]) dots[idx].classList.add('active');
    });
  }

  // ── Elevation Profile ──────────────────────────────────────
  showProfile() {
    this.hidePopup();
    this.elements.profilePanel?.classList.add('visible');
  }

  hideProfile() {
    this.elements.profilePanel?.classList.remove('visible');
  }

  drawProfile(pd) {
    const canvas = this.elements.profileCanvas;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const PAD = { top: 25, right: 15, bottom: 35, left: 50 };

    ctx.clearRect(0, 0, W, H);

    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;

    const fromElev = pd.fromInvert || 0;
    const toElev = pd.toInvert || 0;
    const fromCover = pd.fromMH?.cover_elev || 0;
    const toCover = pd.toMH?.cover_elev || 0;
    const minElev = Math.min(fromElev, toElev, fromCover, toCover) - 0.5;
    const maxElev = Math.max(fromElev, toElev, fromCover, toCover) + 0.5;
    const elevRange = maxElev - minElev || 1;

    const toChartX = (dist) => PAD.left + (dist / (pd.length || 1)) * chartW;
    const toChartY = (elev) => PAD.top + chartH - ((elev - minElev) / elevRange) * chartH;

    // Grid
    ctx.strokeStyle = 'rgba(212,180,131,0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    const step = elevRange > 5 ? 1 : 0.5;
    for (let e = Math.ceil(minElev / step) * step; e <= maxElev; e += step) {
      const y = toChartY(e);
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + chartW, y);
      ctx.stroke();

      ctx.fillStyle = '#D4B483';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(e.toFixed(1), PAD.left - 6, y + 3);
    }
    ctx.setLineDash([]);

    // Ground surface
    ctx.fillStyle = 'rgba(212,136,15,0.08)';
    ctx.strokeStyle = 'rgba(212,136,15,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(toChartX(0), toChartY(fromCover));
    ctx.lineTo(toChartX(pd.length || 1), toChartY(toCover));
    ctx.lineTo(toChartX(pd.length || 1), toChartY(minElev));
    ctx.lineTo(toChartX(0), toChartY(minElev));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Pipe invert
    ctx.strokeStyle = '#D4880F';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(toChartX(0), toChartY(fromElev));
    ctx.lineTo(toChartX(pd.length || 1), toChartY(toElev));
    ctx.stroke();

    // Pipe fill
    ctx.fillStyle = 'rgba(212,136,15,0.15)';
    ctx.beginPath();
    ctx.moveTo(toChartX(0), toChartY(fromElev));
    ctx.lineTo(toChartX(pd.length || 1), toChartY(toElev));
    ctx.lineTo(toChartX(pd.length || 1), toChartY(toCover));
    ctx.lineTo(toChartX(0), toChartY(fromCover));
    ctx.closePath();
    ctx.fill();

    // Endpoints
    this._drawPoint(ctx, toChartX(0), toChartY(fromElev), '#f0a500', pd.fromMH?.name || 'From', '#FFFFFF');
    this._drawPoint(ctx, toChartX(pd.length || 1), toChartY(toElev), '#f0a500', pd.toMH?.name || 'To', '#FFFFFF');

    // Cover points
    ctx.fillStyle = 'rgba(0,200,255,0.5)';
    ctx.beginPath();
    ctx.arc(toChartX(0), toChartY(fromCover), 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(toChartX(pd.length || 1), toChartY(toCover), 3, 0, Math.PI * 2);
    ctx.fill();

    // Labels
    ctx.fillStyle = '#D4B483';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('DISTANCE (m)', PAD.left + chartW / 2, H - 8);

    ctx.save();
    ctx.translate(12, PAD.top + chartH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('ELEVATION (m)', 0, 0);
    ctx.restore();

    // Distance ticks
    ctx.strokeStyle = '#D4B483';
    ctx.fillStyle = '#D4B483';
    const distStep = (pd.length || 1) > 50 ? 10 : ((pd.length || 1) > 20 ? 5 : 1);
    for (let d = 0; d <= (pd.length || 1); d += distStep) {
      const x = toChartX(d);
      ctx.beginPath();
      ctx.moveTo(x, PAD.top + chartH);
      ctx.lineTo(x, PAD.top + chartH + 4);
      ctx.stroke();
      ctx.fillText(d.toFixed(0), x, PAD.top + chartH + 16);
    }

    // Title
    ctx.fillStyle = '#1C3557';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Pipe ${pd.id || '?'} — ${pd.diameter_mm || 0} mm`, PAD.left, 16);

    // Grade arrow
    const midX = toChartX((pd.length || 1) / 2);
    const midY = toChartY((fromElev + toElev) / 2);
    ctx.fillStyle = (pd.grade || 0) >= 0 ? '#2E8B57' : '#C0392B';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    const gradeText = `${(pd.grade || 0) >= 0 ? '▲ ' : '▼ '}${Math.abs(pd.grade || 0).toFixed(2)}%`;
    ctx.fillText(gradeText, midX, midY - 8);

    // Stats panel
    const gradeClass = (pd.grade || 0) >= 0 ? 'up' : 'down';
    const gradeArrow = (pd.grade || 0) >= 0 ? '▲' : '▼';

    if (this.elements.profileStats) {
      this.elements.profileStats.innerHTML = `
        <div class="profile-stat"><div class="profile-stat-label">Length</div><div class="profile-stat-value">${(pd.length || 0).toFixed(2)} m</div></div>
        <div class="profile-stat"><div class="profile-stat-label">Diameter</div><div class="profile-stat-value">${pd.diameter_mm || 0} mm</div></div>
        <div class="profile-stat"><div class="profile-stat-label">Grade</div><div class="profile-stat-value ${gradeClass}">${gradeArrow} ${Math.abs(pd.grade || 0).toFixed(2)}%</div></div>
        <div class="profile-stat"><div class="profile-stat-label">Fall / Rise</div><div class="profile-stat-value ${gradeClass}">${((pd.toInvert || 0) - (pd.fromInvert || 0)).toFixed(3)} m</div></div>
        <div class="profile-stat"><div class="profile-stat-label">Upstream</div><div class="profile-stat-value">${pd.fromMH?.name || '?'}</div></div>
        <div class="profile-stat"><div class="profile-stat-label">Downstream</div><div class="profile-stat-value">${pd.toMH?.name || '?'}</div></div>
        <div class="profile-stat"><div class="profile-stat-label">Up. Invert</div><div class="profile-stat-value">${(pd.fromInvert || 0).toFixed(3)} m</div></div>
        <div class="profile-stat"><div class="profile-stat-label">Down. Invert</div><div class="profile-stat-value">${(pd.toInvert || 0).toFixed(3)} m</div></div>
      `;
    }
  }

  _drawPoint(ctx, x, y, color, label, textColor = '#1C3557') {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = textColor;
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y - 10);
  }

  // ── Measure Tool ───────────────────────────────────────────
  setMeasureMode(active) {
    if (this.elements.measureBtn) {
      this.elements.measureBtn.textContent = active ? 'CANCEL' : 'MEASURE DISTANCE';
      this.elements.measureBtn.classList.toggle('active', active);
    }

    if (active) {
      this.elements.measurePanel?.classList.add('visible');
      this.setMeasureResult('Click first point...');
    } else {
      this.elements.measurePanel?.classList.remove('visible');
    }
  }

  setMeasureResult(text) {
    if (this.elements.measureResult) {
      this.elements.measureResult.innerHTML = text;
    }
  }

  // ── View Buttons ───────────────────────────────────────────
  setActiveView(viewName) {
    this.elements.viewButtons?.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });
  }

  // ── Layer Controls ─────────────────────────────────────────
  setupLayerControls(callbacks) {
    this.elements.layerMH?.addEventListener('change', (e) => {
      callbacks.onManholeLayer?.(e.target.checked);
    });

    this.elements.layerPipes?.addEventListener('change', (e) => {
      callbacks.onPipeLayer?.(e.target.checked);
    });

    this.elements.layerBasemap?.addEventListener('change', (e) => {
      callbacks.onBasemapLayer?.(e.target.checked);
    });

    this.elements.layerGround?.addEventListener('change', (e) => {
      callbacks.onGroundLayer?.(e.target.checked);
    });
  }

  // ── Slider Controls ────────────────────────────────────────
  setupSliderControls(callbacks) {
    this.elements.elevSlider?.addEventListener('input', (e) => {
      const offset = parseFloat(e.target.value);
      const baseElev = 1546.83;
      const newElev = baseElev + offset;

      if (this.elements.elevDisplay) {
        this.elements.elevDisplay.textContent = `${offset >= 0 ? '+' : ''}${offset.toFixed(1)}m`;
      }
      if (this.elements.elevAbs) {
        this.elements.elevAbs.textContent = `Abs: ${newElev.toFixed(2)}m`;
      }
      callbacks.onElevChange?.(offset);
    });

    this.elements.opacitySlider?.addEventListener('input', (e) => {
      const opacity = parseInt(e.target.value);
      if (this.elements.opacityDisplay) {
        this.elements.opacityDisplay.textContent = `${opacity}%`;
      }
      callbacks.onOpacityChange?.(opacity);
    });
  }
}
