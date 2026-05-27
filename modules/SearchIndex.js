/**
 * SearchIndex.js — Fast Search, Filter & Lookup Engine
 * 
 * Pre-builds all indices at init for O(1) lookups.
 * Supports: ID lookup, name search, type filter, range filters.
 */

export class SearchIndex {
  constructor(networkData, coordSystem) {
    this.data = networkData;
    this.coordSystem = coordSystem;
    this._buildIndices();
  }

  _buildIndices() {
    const { manholes, pipes } = this.data;

    // ── Manhole indices ──
    this.mhIdMap = new Map();      // id -> index
    this.mhNameMap = new Map();    // lowercase name -> index
    this.mhTypeLists = { Sewer: [], Stormwater: [] };
    this.mhAllNames = [];          // For autocomplete

    this.mhDepthRange = [Infinity, -Infinity];
    this.mhElevRange = [Infinity, -Infinity];

    manholes.forEach((mh, i) => {
      this.mhIdMap.set(mh.id, i);
      const lowerName = mh.name.toLowerCase();
      this.mhNameMap.set(lowerName, i);
      this.mhAllNames.push({ name: lowerName, index: i });
      this.mhTypeLists[mh.type]?.push(i);

      const depth = mh.depth || 0;
      this.mhDepthRange[0] = Math.min(this.mhDepthRange[0], depth);
      this.mhDepthRange[1] = Math.max(this.mhDepthRange[1], depth);
      this.mhElevRange[0] = Math.min(this.mhElevRange[0], mh.cover_elev);
      this.mhElevRange[1] = Math.max(this.mhElevRange[1], mh.cover_elev);
    });

    // Sort names for fast prefix search
    this.mhAllNames.sort((a, b) => a.name.localeCompare(b.name));

    // Pre-compute scene positions for fly-to
    this.mhScenePositions = manholes.map(mh => 
      this.coordSystem.w2s(mh.x, mh.y, mh.cover_elev)
    );

    // ── Pipe indices ──
    this.pipeDiameterRange = [Infinity, -Infinity];
    this.pipeTypeLists = { Sewer: [], Stormwater: [] };
    this.pipeFromMap = new Map();  // from_mh id -> [pipe indices]
    this.pipeToMap = new Map();    // to_mh id -> [pipe indices]

    pipes.forEach((p, i) => {
      this.pipeDiameterRange[0] = Math.min(this.pipeDiameterRange[0], p.diameter_mm);
      this.pipeDiameterRange[1] = Math.max(this.pipeDiameterRange[1], p.diameter_mm);

      const fromIdx = this.mhIdMap.get(p.from_mh);
      const toIdx = this.mhIdMap.get(p.to_mh);
      const fromMH = fromIdx !== undefined ? manholes[fromIdx] : null;
      const toMH = toIdx !== undefined ? manholes[toIdx] : null;

      const type = (fromMH?.type === 'Stormwater' || toMH?.type === 'Stormwater')
        ? 'Stormwater' : 'Sewer';
      this.pipeTypeLists[type]?.push(i);

      // Build adjacency for network tracing
      if (!this.pipeFromMap.has(p.from_mh)) this.pipeFromMap.set(p.from_mh, []);
      if (!this.pipeToMap.has(p.to_mh)) this.pipeToMap.set(p.to_mh, []);
      this.pipeFromMap.get(p.from_mh).push(i);
      this.pipeToMap.get(p.to_mh).push(i);
    });
  }

  /**
   * Search manholes by ID, name, or type prefix.
   * Returns array of { index, data, matchType } sorted by relevance.
   */
  search(query) {
    if (!query || query.trim().length === 0) return [];
    const q = query.toLowerCase().trim();
    const seen = new Set();
    const results = [];

    const addResult = (idx, matchType, score) => {
      if (seen.has(idx)) return;
      seen.add(idx);
      results.push({ index: idx, data: this.data.manholes[idx], matchType, score });
    };

    // 1. Exact ID match (highest priority)
    const idMatch = this.mhIdMap.get(q.toUpperCase());
    if (idMatch !== undefined) {
      addResult(idMatch, 'id', 0);
    }

    // 2. Exact name match
    const exactName = this.mhNameMap.get(q);
    if (exactName !== undefined) {
      addResult(exactName, 'name', 1);
    }

    // 3. Prefix matches on name (binary search for efficiency)
    const prefixMatches = this._binarySearchPrefix(q);
    prefixMatches.forEach(idx => addResult(idx, 'name', 2));

    // 4. Substring matches (only if few results so far)
    if (results.length < 12) {
      for (const { name, index } of this.mhAllNames) {
        if (!seen.has(index) && name.includes(q)) {
          addResult(index, 'name', 3);
        }
        if (results.length >= 15) break;
      }
    }

    // 5. Type prefix match (e.g., "sew" matches Sewer, "sto" matches Stormwater)
    if (results.length < 8) {
      const typeMatch = q.startsWith('sew') ? 'Sewer' : (q.startsWith('sto') || q.startsWith('sw')) ? 'Stormwater' : null;
      if (typeMatch) {
        this.mhTypeLists[typeMatch].forEach(idx => {
          if (!seen.has(idx)) addResult(idx, 'type', 4);
        });
      }
    }

    return results.slice(0, 15);
  }

  /**
   * Binary search for names starting with prefix.
   * O(log n + k) where k = matches.
   */
  _binarySearchPrefix(prefix) {
    const results = [];
    const arr = this.mhAllNames;
    const len = arr.length;
    if (len === 0) return results;

    // Find leftmost match
    let left = 0, right = len;
    while (left < right) {
      const mid = (left + right) >> 1;
      if (arr[mid].name < prefix) left = mid + 1;
      else right = mid;
    }

    // Collect all matches from left onward
    for (let i = left; i < len && arr[i].name.startsWith(prefix); i++) {
      results.push(arr[i].index);
    }
    return results;
  }

  /**
   * Filter manholes by criteria. Returns indices.
   */
  filterManholes({ type, minDepth, maxDepth, minElev, maxElev, searchQuery }) {
    let candidates;

    if (type && this.mhTypeLists[type]) {
      candidates = this.mhTypeLists[type];
    } else {
      candidates = this.data.manholes.map((_, i) => i);
    }

    // Apply search query filter if provided
    if (searchQuery && searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const searchResults = new Set(this.search(searchQuery).map(r => r.index));
      candidates = candidates.filter(i => searchResults.has(i));
    }

    return candidates.filter(i => {
      const mh = this.data.manholes[i];
      if (minDepth !== undefined && (mh.depth || 0) < minDepth) return false;
      if (maxDepth !== undefined && (mh.depth || 0) > maxDepth) return false;
      if (minElev !== undefined && mh.cover_elev < minElev) return false;
      if (maxElev !== undefined && mh.cover_elev > maxElev) return false;
      return true;
    });
  }

  findById(id) {
    const idx = this.mhIdMap.get(id);
    return idx !== undefined ? { index: idx, data: this.data.manholes[idx] } : null;
  }

  getScenePosition(index) {
    return this.mhScenePositions[index];
  }

  getStats() {
    return {
      manholeCount: this.data.manholes.length,
      pipeCount: this.data.pipes.length,
      depthRange: this.mhDepthRange,
      elevRange: this.mhElevRange,
      pipeDiameterRange: this.pipeDiameterRange,
      typeCounts: {
        Sewer: this.mhTypeLists.Sewer.length,
        Stormwater: this.mhTypeLists.Stormwater.length
      }
    };
  }
}