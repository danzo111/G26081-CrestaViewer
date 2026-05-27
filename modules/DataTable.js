/**
 * DataTable.js — Virtual Scrolling Manhole Table
 * 
 * Renders only visible rows (~12-15 at a time) regardless of dataset size.
 * Sortable columns. Click row → flies camera to manhole.
 * Keyboard: ArrowUp/ArrowDown to navigate, Enter to select.
 */

export class DataTable {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) throw new Error(`Container #${containerId} not found`);

    this.onRowClick = options.onRowClick || (() => {});
    this.rowHeight = 36; // Increased for readability
    this.visibleBuffer = 3; // Extra rows above/below viewport
    this.data = [];
    this.filteredData = [];
    this.sortKey = 'name';
    this.sortDir = 1;
    this.selectedIndex = -1;
    this.focusedRow = -1;

    this._buildDOM();
    this._setupScroll();
    this._setupKeyboard();
  }

  _buildDOM() {
    this.container.innerHTML = `
      <div class="dt-header">
        <div class="dt-col sortable" data-sort="name" style="width:85px">ID <span class="sort-icon"></span></div>
        <div class="dt-col sortable" data-sort="type" style="width:95px">Type <span class="sort-icon"></span></div>
        <div class="dt-col sortable" data-sort="cover_elev" style="width:80px">Elev <span class="sort-icon"></span></div>
        <div class="dt-col sortable" data-sort="depth" style="width:65px">Depth <span class="sort-icon"></span></div>
      </div>
      <div class="dt-scroll" tabindex="0">
        <div class="dt-spacer"></div>
        <div class="dt-rows"></div>
      </div>
      <div class="dt-footer"></div>
    `;

    this.scrollEl = this.container.querySelector('.dt-scroll');
    this.spacerEl = this.container.querySelector('.dt-spacer');
    this.rowsEl = this.container.querySelector('.dt-rows');
    this.footerEl = this.container.querySelector('.dt-footer');

    // Sort handlers
    this.container.querySelectorAll('.dt-col.sortable').forEach(col => {
      col.addEventListener('click', () => {
        const key = col.dataset.sort;
        if (this.sortKey === key) {
          this.sortDir *= -1;
        } else {
          this.sortKey = key;
          this.sortDir = 1;
        }
        this._updateSortIndicators();
        this._sort();
        this._render();
      });
    });

    this._updateSortIndicators();
  }

  _updateSortIndicators() {
    this.container.querySelectorAll('.dt-col.sortable').forEach(col => {
      const icon = col.querySelector('.sort-icon');
      col.classList.remove('asc', 'desc');
      if (col.dataset.sort === this.sortKey) {
        col.classList.add(this.sortDir === 1 ? 'asc' : 'desc');
        icon.textContent = this.sortDir === 1 ? ' ▲' : ' ▼';
      } else {
        icon.textContent = '';
      }
    });
  }

  _setupScroll() {
    let ticking = false;
    this.scrollEl.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          this._render();
          ticking = false;
        });
        ticking = true;
      }
    });
  }

  _setupKeyboard() {
    this.scrollEl.addEventListener('keydown', (e) => {
      if (this.filteredData.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          this.focusedRow = Math.min(this.focusedRow + 1, this.filteredData.length - 1);
          this._scrollToFocused();
          this._render();
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.focusedRow = Math.max(this.focusedRow - 1, 0);
          this._scrollToFocused();
          this._render();
          break;
        case 'Enter':
          e.preventDefault();
          if (this.focusedRow >= 0 && this.focusedRow < this.filteredData.length) {
            const data = this.filteredData[this.focusedRow];
            this.onRowClick(data);
            this.setSelectedIndex(data.index);
          }
          break;
      }
    });
  }

  _scrollToFocused() {
    const targetY = this.focusedRow * this.rowHeight;
    const viewTop = this.scrollEl.scrollTop;
    const viewBottom = viewTop + this.scrollEl.clientHeight;

    if (targetY < viewTop) {
      this.scrollEl.scrollTop = targetY;
    } else if (targetY + this.rowHeight > viewBottom) {
      this.scrollEl.scrollTop = targetY + this.rowHeight - this.scrollEl.clientHeight;
    }
  }

  setData(manholes, searchIndex) {
    this.data = manholes.map((mh, i) => ({
      index: i,
      ...mh,
      scenePos: searchIndex.getScenePosition(i)
    }));
    this.filteredData = [...this.data];
    this.focusedRow = 0;
    this._sort();
    this._render();
  }

  filter(predicate) {
    if (!predicate) {
      this.filteredData = [...this.data];
    } else {
      this.filteredData = this.data.filter(predicate);
    }
    this.focusedRow = Math.min(this.focusedRow, this.filteredData.length - 1);
    this._sort();
    this._render();
  }

  _sort() {
    const key = this.sortKey;
    this.filteredData.sort((a, b) => {
      let av = a[key] ?? 0;
      let bv = b[key] ?? 0;
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av < bv) return -this.sortDir;
      if (av > bv) return this.sortDir;
      return 0;
    });
  }

  _render() {
    const scrollTop = this.scrollEl.scrollTop;
    const viewportHeight = this.scrollEl.clientHeight;
    const startIdx = Math.max(0, Math.floor(scrollTop / this.rowHeight) - this.visibleBuffer);
    const endIdx = Math.min(
      startIdx + Math.ceil(viewportHeight / this.rowHeight) + this.visibleBuffer * 2,
      this.filteredData.length
    );

    this.spacerEl.style.height = `${this.filteredData.length * this.rowHeight}px`;
    this.footerEl.textContent = `Showing ${this.filteredData.length} of ${this.data.length} manholes`;

    // Recycle/reuse row elements
    const rows = this.rowsEl.querySelectorAll('.dt-row');
    let rowIdx = 0;

    for (let i = startIdx; i < endIdx; i++) {
      const item = this.filteredData[i];
      let row = rows[rowIdx];

      if (!row) {
        row = document.createElement('div');
        row.className = 'dt-row';
        row.style.height = `${this.rowHeight}px`;
        row.addEventListener('click', () => {
          const data = this.filteredData[i];
          if (data) {
            this.onRowClick(data);
            this.setSelectedIndex(data.index);
          }
        });
        this.rowsEl.appendChild(row);
      }

      row.style.display = 'flex';
      row.style.transform = `translateY(${i * this.rowHeight}px)`;
      row.dataset.rowIndex = i;

      const typeClass = item.type === 'Sewer' ? 'sewer' : 'storm';
      const depthStr = item.depth === 0.33 ? "N/A" : (item.depth || 0).toFixed(2);
      const isSelected = item.index === this.selectedIndex;
      const isFocused = i === this.focusedRow;

      row.innerHTML = `
        <div class="dt-cell" style="width:85px"><span class="dt-tag ${typeClass}">${item.name}</span></div>
        <div class="dt-cell" style="width:95px">${item.type}</div>
        <div class="dt-cell" style="width:80px">${item.cover_elev.toFixed(2)} m</div>
        <div class="dt-cell" style="width:65px">${depthStr} m</div>
      `;

      row.classList.toggle('selected', isSelected);
      row.classList.toggle('focused', isFocused);

      rowIdx++;
    }

    // Hide excess rows
    for (let i = rowIdx; i < rows.length; i++) {
      rows[i].style.display = 'none';
    }
  }

  setSelectedIndex(index) {
    this.selectedIndex = index;
    this._render();
  }

  scrollToIndex(index) {
    const pos = this.filteredData.findIndex(d => d.index === index);
    if (pos >= 0) {
      this.focusedRow = pos;
      this.scrollEl.scrollTop = pos * this.rowHeight;
      this._render();
    }
  }

  getVisibleCount() {
    return this.filteredData.length;
  }
}