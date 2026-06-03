/**
 * Walkthrough.js — Optional guided tour for the Map View.
 *
 * On launch a small welcome card offers a quick tour or lets the user skip.
 * The tour dims the map and spotlights one control at a time (search, legend,
 * layers, clicking a manhole, flow arrows) with Back / Next / Skip controls.
 * Re-openable anytime via the floating "?" button.
 *
 * Self-contained: builds its own DOM and is styled by the .wt-* / #wt-* rules
 * in style.css. Designed for the friendly mall-manager Map View.
 */

const SEEN_KEY = 'netview-walkthrough-seen';

export class Walkthrough {
  constructor() {
    this.stepIndex = 0;
    this.tourActive = false;

    this.steps = [
      {
        target: '#map-search-input',
        title: '1. Find any manhole',
        html: 'Type a manhole ID like <strong>SE001</strong> and press Enter to jump straight to it.'
      },
      {
        target: '.map-legend',
        title: '2. Know the colours',
        html: '<strong style="color:#E87722">Orange</strong> is the sewer network. <strong style="color:#00C8FF">Blue</strong> is stormwater.'
      },
      {
        target: '.map-layers',
        title: '3. Show or hide layers',
        html: 'Switch manholes, pipes, flow arrows and the aerial photo on or off to focus on what matters.'
      },
      {
        target: null,   // no DOM element — this happens out on the map
        title: '4. Click a manhole',
        html: 'Click any dot on the map for its depth and photos — and to trace the water: ' +
              '<strong style="color:#2ECC71">green</strong> is where it comes from, ' +
              '<strong style="color:#E74C3C">red</strong> is where it goes.'
      },
      {
        target: '#flow-toggle',
        title: '5. See the flow',
        html: 'Turn on <strong>flow arrows</strong> to watch which way the water travels through the pipes.'
      }
    ];

    this._build();
    this._wire();
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'wt-root';
    root.innerHTML = `
      <button id="wt-help-btn" title="Help & tour">?</button>

      <div id="wt-welcome">
        <div class="wt-welcome-card">
          <div class="wt-welcome-icon">🗺️</div>
          <h2>Welcome to the Network Viewer</h2>
          <p>This map shows every manhole and pipe on site. Would you like a quick 30-second tour?</p>
          <div class="wt-welcome-actions">
            <button class="wt-btn wt-btn-primary" id="wt-start">Take the tour</button>
            <button class="wt-btn wt-btn-ghost" id="wt-skip">Skip — I'll explore</button>
          </div>
          <label class="wt-dontshow"><input type="checkbox" id="wt-dontshow"> Don't show this again</label>
        </div>
      </div>

      <div id="wt-overlay"></div>

      <div id="wt-tip">
        <div class="wt-tip-title" id="wt-tip-title"></div>
        <div class="wt-tip-text" id="wt-tip-text"></div>
        <div class="wt-tip-footer">
          <div class="wt-dots" id="wt-dots"></div>
          <div class="wt-tip-buttons">
            <button class="wt-btn wt-btn-ghost wt-sm" id="wt-skip-tour">Skip</button>
            <button class="wt-btn wt-btn-ghost wt-sm" id="wt-back">Back</button>
            <button class="wt-btn wt-btn-primary wt-sm" id="wt-next">Next</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    this.welcome = document.getElementById('wt-welcome');
    this.overlay = document.getElementById('wt-overlay');
    this.tip = document.getElementById('wt-tip');
    this.tipTitle = document.getElementById('wt-tip-title');
    this.tipText = document.getElementById('wt-tip-text');
    this.dots = document.getElementById('wt-dots');
    this.backBtn = document.getElementById('wt-back');
    this.nextBtn = document.getElementById('wt-next');

    // One progress dot per step
    this.steps.forEach(() => {
      const d = document.createElement('span');
      d.className = 'wt-dot';
      this.dots.appendChild(d);
    });
  }

  _wire() {
    document.getElementById('wt-help-btn').addEventListener('click', () => this.showWelcome());
    document.getElementById('wt-start').addEventListener('click', () => { this._persistDontShow(); this.startTour(); });
    document.getElementById('wt-skip').addEventListener('click', () => { this._persistDontShow(); this.hideWelcome(); });
    document.getElementById('wt-skip-tour').addEventListener('click', () => this.endTour());
    this.backBtn.addEventListener('click', () => this.prevStep());
    this.nextBtn.addEventListener('click', () => this.nextStep());

    // Keep the tooltip glued to its target if the window changes size
    window.addEventListener('resize', () => { if (this.tourActive) this._render(); });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.hideWelcome(); this.endTour(); }
      else if (this.tourActive && e.key === 'ArrowRight') this.nextStep();
      else if (this.tourActive && e.key === 'ArrowLeft') this.prevStep();
    });
  }

  _persistDontShow() {
    const cb = document.getElementById('wt-dontshow');
    if (cb && cb.checked) localStorage.setItem(SEEN_KEY, 'true');
  }

  /** Show the welcome card on first visit (unless dismissed). */
  maybeAutoShowWelcome() {
    if (localStorage.getItem(SEEN_KEY)) return;
    this.showWelcome();
  }

  showWelcome() {
    this.endTour();
    this.welcome.classList.add('visible');
  }

  hideWelcome() {
    this.welcome.classList.remove('visible');
  }

  /** Used by the '?' key / button. */
  toggle() {
    if (this.welcome.classList.contains('visible') || this.tourActive) {
      this.hideWelcome();
      this.endTour();
    } else {
      this.showWelcome();
    }
  }

  startTour() {
    this.hideWelcome();
    this.stepIndex = 0;
    this.tourActive = true;
    document.body.classList.add('wt-tour-active');
    this.overlay.classList.add('visible');
    this.tip.classList.add('visible');
    this._render();
  }

  endTour() {
    this.tourActive = false;
    document.body.classList.remove('wt-tour-active');
    this.overlay.classList.remove('visible');
    this.tip.classList.remove('visible');
    this._clearTarget();
  }

  nextStep() {
    if (this.stepIndex >= this.steps.length - 1) { this.endTour(); return; }
    this.stepIndex++;
    this._render();
  }

  prevStep() {
    if (this.stepIndex <= 0) return;
    this.stepIndex--;
    this._render();
  }

  _clearTarget() {
    document.querySelectorAll('.wt-target').forEach(el => el.classList.remove('wt-target'));
  }

  _render() {
    const step = this.steps[this.stepIndex];
    this.tipTitle.textContent = step.title;
    this.tipText.innerHTML = step.html;

    Array.from(this.dots.children).forEach((d, i) =>
      d.classList.toggle('active', i === this.stepIndex));

    this.backBtn.style.visibility = this.stepIndex === 0 ? 'hidden' : 'visible';
    this.nextBtn.textContent = this.stepIndex === this.steps.length - 1 ? 'Done' : 'Next';

    this._clearTarget();
    const targetEl = step.target ? document.querySelector(step.target) : null;
    if (targetEl) targetEl.classList.add('wt-target');

    // Position after the tip has its final size
    requestAnimationFrame(() => this._positionTip(targetEl));
  }

  _positionTip(targetEl) {
    const tip = this.tip;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const gap = 18;

    // No element to point at → centre of screen
    if (!targetEl) {
      tip.style.left = '50%';
      tip.style.top = '50%';
      tip.style.transform = 'translate(-50%, -50%)';
      return;
    }

    tip.style.transform = 'none';
    const r = targetEl.getBoundingClientRect();
    let left, top;

    if (r.right + gap + tw < window.innerWidth) {        // prefer right of target
      left = r.right + gap; top = r.top;
    } else if (r.left - gap - tw > 0) {                  // else left
      left = r.left - gap - tw; top = r.top;
    } else if (r.bottom + gap + th < window.innerHeight) { // else below
      left = r.left; top = r.bottom + gap;
    } else {                                             // else centre
      left = (window.innerWidth - tw) / 2;
      top = (window.innerHeight - th) / 2;
    }

    // Keep fully on-screen
    top = Math.max(12, Math.min(top, window.innerHeight - th - 12));
    left = Math.max(12, Math.min(left, window.innerWidth - tw - 12));
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
}
