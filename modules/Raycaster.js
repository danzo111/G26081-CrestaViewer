/**
 * Raycaster.js — Distance-Scaled 3D Object Picking
 * 
 * Tolerance scales with camera distance so clicking is easy from ANY zoom:
 * - Close up: tight tolerance (must click near the object)
 * - Far away: larger tolerance (easier to hit from distance)
 * Uses native Three.js Ray methods for accuracy.
 */

import * as THREE from 'three';

export class RaycasterManager {
  constructor(camera, renderer) {
    this.camera = camera;
    this.renderer = renderer;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.gridCellSize = 40.0;
    this.mhSpatialGrid = new Map();
    this.pipeSpatialGrid = new Map();

    // Base hit radius in meters (at camera distance = 0)
    this.MH_BASE_RADIUS = 2.5;   // Manhole base hit radius
    this.PIPE_BASE_RADIUS = 2.0;  // Pipe base hit radius

    // How much tolerance increases per 100m of camera distance
    this.MH_SCALE_FACTOR = 0.08;   // +0.08m per 100m distance
    this.PIPE_SCALE_FACTOR = 0.06; // +0.06m per 100m distance
  }

  buildManholeIndex(mhInstData) {
    this.mhSpatialGrid.clear();
    this.mhList = mhInstData;
    mhInstData.forEach((mh, i) => {
      const cellKey = this._getCellKey(mh.topS.x, mh.topS.z);
      if (!this.mhSpatialGrid.has(cellKey)) {
        this.mhSpatialGrid.set(cellKey, []);
      }
      this.mhSpatialGrid.get(cellKey).push({ index: i, data: mh });
    });
  }

  buildPipeIndex(pipeData) {
    this.pipeSpatialGrid.clear();
    this.pipeList = pipeData;
    pipeData.forEach((pd, i) => {
      if (!pd) return;
      const minX = Math.min(pd.p1.x, pd.p2.x);
      const maxX = Math.max(pd.p1.x, pd.p2.x);
      const minZ = Math.min(pd.p1.z, pd.p2.z);
      const maxZ = Math.max(pd.p1.z, pd.p2.z);
      const startCell = this._getCellKey(minX, minZ);
      const endCell = this._getCellKey(maxX, maxZ);
      const [startCx, startCz] = startCell.split(',').map(Number);
      const [endCx, endCz] = endCell.split(',').map(Number);
      for (let cx = startCx; cx <= endCx; cx++) {
        for (let cz = startCz; cz <= endCz; cz++) {
          const key = `${cx},${cz}`;
          if (!this.pipeSpatialGrid.has(key)) {
            this.pipeSpatialGrid.set(key, []);
          }
          this.pipeSpatialGrid.get(key).push({ index: i, data: pd });
        }
      }
    });
  }

  _getCellKey(x, z) {
    const cx = Math.floor(x / this.gridCellSize);
    const cz = Math.floor(z / this.gridCellSize);
    return `${cx},${cz}`;
  }

  /**
   * Calculate hit radius based on camera distance to object.
   * Closer = tighter, farther = looser, but never smaller than base.
   */
  _getManholeHitRadius(mh) {
    const dist = this.camera.position.distanceTo(mh.topS);
    const scale = Math.max(1.0, dist / 100.0); // 1.0 at close, grows at distance
    return Math.max(mh.r * 1.5, this.MH_BASE_RADIUS * scale * this.MH_SCALE_FACTOR * 10);
  }

  _getPipeHitRadius(pd) {
    const mid = new THREE.Vector3().addVectors(pd.p1, pd.p2).multiplyScalar(0.5);
    const dist = this.camera.position.distanceTo(mid);
    const scale = Math.max(1.0, dist / 100.0);
    return Math.max(pd.rp * 2.0, this.PIPE_BASE_RADIUS * scale * this.PIPE_SCALE_FACTOR * 10);
  }

  castRay(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const ray = this.raycaster.ray;
    const originCell = this._getCellKey(ray.origin.x, ray.origin.z);

    // STEP 1: Check manholes FIRST
    const mhHit = this._raycastManholes(ray, originCell);
    if (mhHit) return mhHit;

    // STEP 2: Only check pipes if NO manhole was hit
    const pipeHit = this._raycastPipes(ray, originCell);
    if (pipeHit) return pipeHit;

    return null;
  }

  _raycastManholes(ray, originCell) {
    let bestDist = Infinity;
    let bestIdx = -1;

    const [ocx, ocz] = originCell.split(',').map(Number);
    const tempSphere = new THREE.Sphere();

    // Check 5x5 grid for broad search from far away
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const cellKey = `${ocx + dx},${ocz + dz}`;
        const cell = this.mhSpatialGrid.get(cellKey);
        if (!cell) continue;

        for (const { index, data: mh } of cell) {
          // Dynamic hit radius based on camera distance
          const hitRadius = this._getManholeHitRadius(mh);
          tempSphere.set(mh.topS, hitRadius);

          if (ray.intersectsSphere(tempSphere)) {
            const closestPoint = new THREE.Vector3();
            ray.closestPointToPoint(mh.topS, closestPoint);
            const dist = ray.origin.distanceTo(closestPoint);
            if (dist < bestDist) {
              bestDist = dist;
              bestIdx = index;
            }
          }
        }
      }
    }

    return bestIdx >= 0 ? { type: 'manhole', idx: bestIdx, dist: bestDist } : null;
  }

  _raycastPipes(ray, originCell) {
    let bestDist = Infinity;
    let bestIdx = -1;

    const [ocx, ocz] = originCell.split(',').map(Number);
    const pointOnRay = new THREE.Vector3();
    const pointOnSegment = new THREE.Vector3();

    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const cellKey = `${ocx + dx},${ocz + dz}`;
        const cell = this.pipeSpatialGrid.get(cellKey);
        if (!cell) continue;

        for (const { index, data: pd } of cell) {
          if (!pd) continue;

          const distSq = ray.distanceSqToSegment(
            pd.p1, pd.p2,
            pointOnRay, pointOnSegment
          );

          if (distSq === null) continue;

          const dist = Math.sqrt(distSq);
          // Dynamic hit radius based on camera distance
          const hitRadius = this._getPipeHitRadius(pd);

          if (dist <= hitRadius) {
            const rayDist = ray.origin.distanceTo(pointOnRay);
            if (rayDist < bestDist) {
              bestDist = rayDist;
              bestIdx = index;
            }
          }
        }
      }
    }

    return bestIdx >= 0 ? { type: 'pipe', idx: bestIdx, dist: bestDist } : null;
  }

  castRayToGround(event, targetObjects) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const validTargets = targetObjects.filter(Boolean);
    if (validTargets.length === 0) return null;

    const intersects = this.raycaster.intersectObjects(validTargets);
    return intersects.length > 0 ? intersects[0].point : null;
  }

  dispose() {
    this.mhSpatialGrid.clear();
    this.pipeSpatialGrid.clear();
  }
}