/**
 * CoordinateSystem.js — Survey-to-Scene Coordinate Transforms
 * 
 * Handles all coordinate transformations between survey coordinates
 * and Three.js scene coordinates. Isolated for testability and reuse.
 */

import * as THREE from 'three';

export class CoordinateSystem {
  constructor(networkData, options = {}) {
    this.rotate180 = options.rotate180 ?? networkData?.metadata?.rotate_180 ?? true;

    // Compute scene origin from data centroid
    const xs = networkData.manholes.map(m => m.x);
    const ys = networkData.manholes.map(m => m.y);
    this.originX = xs.reduce((a, b) => a + b, 0) / xs.length;
    this.originY = ys.reduce((a, b) => a + b, 0) / ys.length;

    // Compute minimum elevation for scene origin
    const allInverts = networkData.manholes.map(m => 
      m.cover_elev - Math.max(m.depth || 0, 0)
    );
    this.originElev = Math.min(...allInverts) - 2.0;

    // Ground plane Y position
    const avgCoverElev = networkData.manholes.reduce((s, m) => s + m.cover_elev, 0) 
                       / networkData.manholes.length;
    this.groundSceneY = avgCoverElev - this.originElev;

    // Metadata
    this.metadata = networkData.metadata || {};
    this.basemapElev = this.metadata.basemap_elev || 1546.83;
    this.basemapBounds = this.metadata.basemap_bounds || {};
  }

  /**
   * Convert survey coordinates to scene coordinates
   * @param {number} wx - World X (Easting)
   * @param {number} wy - World Y (Northing)
   * @param {number} wz - World Z (Elevation)
   * @returns {THREE.Vector3} Scene position
   */
  w2s(wx, wy, wz) {
    const dx = wx - this.originX;
    const dz = -(wy - this.originY);

    if (this.rotate180) {
      return new THREE.Vector3(-dx, wz - this.originElev, -dz);
    } else {
      return new THREE.Vector3(dx, wz - this.originElev, dz);
    }
  }

  /**
   * Convert scene coordinates back to survey coordinates
   * @param {THREE.Vector3} scenePos - Scene position
   * @returns {Object} {x, y, z} survey coordinates
   */
  s2w(scenePos) {
    const dx = this.rotate180 ? -scenePos.x : scenePos.x;
    const dz = this.rotate180 ? -scenePos.z : scenePos.z;

    return {
      x: this.originX + dx,
      y: this.originY - dz,
      z: scenePos.y + this.originElev
    };
  }

  /**
   * Get CRS label for display
   * @returns {string} Formatted CRS string
   */
  getCRSLabel() {
    return `E ${(-this.originX).toFixed(0)}  N ${this.originY.toFixed(0)}`;
  }

  /**
   * Get basemap center in scene coordinates
   * @returns {THREE.Vector3}
   */
  getBasemapCenter() {
    const bounds = this.basemapBounds;
    const cx = (bounds.left + bounds.right) / 2;
    const cy = (bounds.bottom + bounds.top) / 2;
    return this.w2s(cx, cy, this.originElev);
  }

  /**
   * Get basemap dimensions
   * @returns {Object} {width, height}
   */
  getBasemapSize() {
    const bounds = this.basemapBounds;
    return {
      width: bounds.right - bounds.left,
      height: bounds.top - bounds.bottom
    };
  }

  /**
   * Compute bounding box of all manholes in scene coordinates
   * @param {Array} manholes - Manhole data array
   * @returns {THREE.Box3}
   */
  computeBoundingBox(manholes) {
    const box = new THREE.Box3();
    manholes.forEach(mh => {
      box.expandByPoint(this.w2s(mh.x, mh.y, mh.cover_elev));
      box.expandByPoint(this.w2s(mh.x, mh.y, mh.cover_elev - (mh.depth || 0)));
    });
    return box;
  }
}
