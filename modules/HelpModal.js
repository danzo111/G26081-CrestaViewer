/**
 * HelpModal.js — Welcome & Feature Guide Modal
 * 
 * Shows on first visit (stored in localStorage).
 * Can be reopened via Help button or '?' key.
 * Explains all features with clear sections.
 */

export class HelpModal {
  constructor() {
    this.visible = false;
    this._buildDOM();
    this._setupEvents();
  }

  _buildDOM() {
    // Create modal container
    const modal = document.createElement('div');
    modal.id = 'help-modal';
    modal.innerHTML = `
      <div class="help-overlay"></div>
      <div class="help-card">
        <div class="help-header">
          <h2>⬡ NetView 3D — Quick Guide</h2>
          <button class="help-close" id="help-close" title="Close (Esc)">×</button>
        </div>
        <div class="help-body">

          <div class="help-section">
            <h3>🖱 Navigation</h3>
            <div class="help-grid">
              <div class="help-item"><span class="help-key">Drag</span><span>Orbit camera</span></div>
              <div class="help-item"><span class="help-key">Right-drag</span><span>Pan view</span></div>
              <div class="help-item"><span class="help-key">Scroll</span><span>Zoom in/out</span></div>
              <div class="help-item"><span class="help-key">Double-click logo</span><span>Reset view</span></div>
            </div>
          </div>

          <div class="help-section">
            <h3>👆 Selection</h3>
            <div class="help-grid">
              <div class="help-item"><span class="help-key">Click manhole</span><span>View details & photos</span></div>
              <div class="help-item"><span class="help-key">Click pipe</span><span>View profile & connected manholes</span></div>
              <div class="help-item"><span class="help-key">Esc</span><span>Clear selection</span></div>
            </div>
          </div>

          <div class="help-section">
            <h3>🔍 Search & Filter</h3>
            <div class="help-grid">
              <div class="help-item"><span class="help-key">T</span><span>Toggle data panel</span></div>
              <div class="help-item"><span class="help-key">Search box</span><span>Find manholes by ID/name</span></div>
              <div class="help-item"><span class="help-key">Filter buttons</span><span>Show only Sewer or Stormwater</span></div>
              <div class="help-item"><span class="help-key">Table rows</span><span>Click to fly to manhole</span></div>
            </div>
          </div>

          <div class="help-section">
            <h3>⬇ Flow Direction</h3>
            <div class="help-grid">
              <div class="help-item"><span class="help-key">Bottom-left button</span><span>Toggle flow arrows</span></div>
              <div class="help-item"><span class="help-key">Arrows</span><span>Show water flow direction</span></div>
              <div class="help-item"><span class="help-key">F</span><span>Keyboard shortcut</span></div>
            </div>
          </div>

          <div class="help-section">
            <h3>📐 Tools</h3>
            <div class="help-grid">
              <div class="help-item"><span class="help-key">M</span><span>Measure distance on ground</span></div>
              <div class="help-item"><span class="help-key">1–6</span><span>Camera views (ISO, Top, Front, etc.)</span></div>
              <div class="help-item"><span class="help-key">Layers panel</span><span>Toggle manholes, pipes, basemap</span></div>
            </div>
          </div>

          <div class="help-section">
            <h3>🎨 Legend</h3>
            <div class="help-legend-row">
              <span class="help-dot" style="background:#D4880F"></span><span>Sewer Manhole</span>
              <span class="help-dot" style="background:#00c8ff"></span><span>Stormwater Manhole</span>
              <span class="help-dot" style="background:#1C3557"></span><span>Shaft</span>
              <span class="help-line" style="background:#4A90D9"></span><span>Storm Pipe</span>
              <span class="help-line" style="background:#D4880F"></span><span>Sewer Pipe</span>
            </div>
          </div>

        </div>
        <div class="help-footer">
          <label class="help-checkbox">
            <input type="checkbox" id="help-dont-show">
            <span>Don't show again</span>
          </label>
          <button class="help-done" id="help-done">Got it</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Help button (small circle with ?)
    const btn = document.createElement('button');
    btn.id = 'help-btn';
    btn.innerHTML = '?';
    btn.title = 'Open help guide (? key)';
    document.body.appendChild(btn);
  }

  _setupEvents() {
    document.getElementById('help-close')?.addEventListener('click', () => this.hide());
    document.getElementById('help-done')?.addEventListener('click', () => this.hide());
    document.getElementById('help-overlay')?.addEventListener('click', () => this.hide());
    document.getElementById('help-btn')?.addEventListener('click', () => this.show());

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.visible) this.hide();
      if (e.key === '?' && e.target.tagName !== 'INPUT') this.toggle();
    });
  }

  show() {
    this.visible = true;
    document.getElementById('help-modal')?.classList.add('visible');
  }

  hide() {
    this.visible = false;
    document.getElementById('help-modal')?.classList.remove('visible');

    // Save "don't show again" preference
    const dontShow = document.getElementById('help-dont-show')?.checked;
    if (dontShow) {
      localStorage.setItem('netview-help-dismissed', 'true');
    }
  }

  toggle() {
    this.visible ? this.hide() : this.show();
  }

  /**
   * Check if should auto-show on first visit.
   * Call this after app init.
   */
  maybeAutoShow() {
    const dismissed = localStorage.getItem('netview-help-dismissed');
    if (!dismissed) {
      // Small delay so user sees the app first
      setTimeout(() => this.show(), 800);
    }
  }
}
