/**
 * FlowArrows.js — Flow Direction Visualization
 * 
 * FLOW DIRECTION LOGIC:
 * Water flows from HIGHER invert elevation to LOWER invert elevation.
 * 
 * For each pipe:
 *   fromInvert = fromMH.cover_elev - pipe.from_depth
 *   toInvert   = toMH.cover_elev   - pipe.to_depth
 * 
 * Dummy manholes inherit their elevation from their parent manhole,
 * so we resolve parent_mh when computing invert elevations.
 * 
 * The arrow mesh is placed at the pipe midpoint, pointing downstream.
 * Uses a single InstancedMesh for all arrows (1 draw call).
 * Auto-fades when camera is far away.
 */

import * as THREE from 'three';

export class FlowArrows {
  constructor(scene, pipeData, coordSystem, mhLookup = null) {
    this.scene = scene;
    this.pipeData = pipeData;
    this.coordSystem = coordSystem;
    this.mhLookup = mhLookup;
    this.mesh = null;
    this.visible = false;
    this._buildMesh();
  }

  /**
   * Resolve a manhole ID to its effective cover elevation.
   * If the manhole is a dummy with a parent, use the parent's cover_elev.
   */
  _resolveCoverElev(mhId) {
    if (!this.mhLookup) return null;
    const mh = this.mhLookup[mhId];
    if (!mh) return null;

    // If dummy has a parent, use parent's cover_elev
    if (mh.parent_mh && this.mhLookup[mh.parent_mh]) {
      return this.mhLookup[mh.parent_mh].cover_elev;
    }
    return mh.cover_elev;
  }

  _buildMesh() {
    // Arrow geometry: cone pointing along +Y, translated so base is at origin
    const coneGeo = new THREE.ConeGeometry(0.18, 0.45, 8);
    coneGeo.translate(0, 0.225, 0);

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x00aaff,
      emissiveIntensity: 2.0,
      roughness: 0.2,
      metalness: 0.6,
      transparent: true,
      opacity: 0.95
    });

    // Collect ALL valid pipes — ensure none are skipped
    const validPipes = [];
    for (let i = 0; i < this.pipeData.length; i++) {
      const p = this.pipeData[i];
      if (!p) continue;
      // Accept any pipe that has valid endpoint data
      if (!p.p1 || !p.p2) continue;
      validPipes.push(p);
    }

    const count = validPipes.length;
    if (count === 0) {
      console.warn('FlowArrows: no valid pipes found for flow arrows');
      return;
    }

    console.log(`FlowArrows: creating ${count} arrows for ${this.pipeData.length} total pipes`);

    this.mesh = new THREE.InstancedMesh(coneGeo, material, count);
    this.mesh.name = 'flow_arrows';
    this.mesh.visible = false;
    this.mesh.renderOrder = 10;

    const dummy = new THREE.Object3D();

    for (let i = 0; i < validPipes.length; i++) {
      const pd = validPipes[i];

      let start, end;

      // For dummy pipes OR pipes flagged with flow_override, use the JSON
      // from_mh/to_mh definition as flow direction (skip invert calculation)
      const isDummyPipe = pd.id && pd.id.startsWith('DUMMY_PIPE');
      const hasFlowOverride = pd.flow_override === true;

      if (isDummyPipe || hasFlowOverride) {
        // Flow follows the JSON from_mh -> to_mh definition
        start = pd.p1;
        end = pd.p2;
      } else {
        // Regular pipes: compute flow direction from invert elevations
        // RESOLVE parent manholes for dummies to get correct elevations
        const fromCover = this._resolveCoverElev(pd.fromMH?.id);
        const toCover = this._resolveCoverElev(pd.toMH?.id);
        
        const fromDepth = pd.fromDepth ?? pd.from_depth ?? 0;
        const toDepth = pd.toDepth ?? pd.to_depth ?? 0;
        
        const fromInvert = fromCover !== null ? fromCover - fromDepth : null;
        const toInvert = toCover !== null ? toCover - toDepth : null;

        if (fromInvert === null || toInvert === null) {
          // Fallback to pre-computed values if resolution fails
          start = pd.p1;
          end = pd.p2;
        } else if (fromInvert > toInvert) {
          start = pd.p1;
          end = pd.p2;
        } else if (toInvert > fromInvert) {
          start = pd.p2;
          end = pd.p1;
        } else {
          // Equal inverts — fallback to JSON order
          start = pd.p1;
          end = pd.p2;
        }
      }

      const dir = new THREE.Vector3().subVectors(end, start).normalize();
      const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);

      // Position arrow at midpoint, slightly above pipe
      dummy.position.copy(mid).add(new THREE.Vector3(0, pd.rp * 2.5 + 0.4, 0));

      // Orient arrow along flow direction
      const up = new THREE.Vector3(0, 1, 0);
      dummy.quaternion.setFromUnitVectors(up, dir);

      // Scale based on pipe size
      const scale = Math.min(2.0, Math.max(0.8, pd.rp * 10));
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.scene.add(this.mesh);
  }

  setVisible(visible) {
    this.visible = visible;
    if (this.mesh) this.mesh.visible = visible;
  }

  toggle() {
    this.setVisible(!this.visible);
    return this.visible;
  }

  update(camera) {
    if (!this.mesh || !this.visible) return;

    const dist = camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
    // Fade opacity: full at <150m, fade to 0 at >400m
    const targetOpacity = dist > 400 ? 0 : (dist > 150 ? 0.95 * (1 - (dist - 150) / 250) : 0.95);

    if (Math.abs(this.mesh.material.opacity - targetOpacity) > 0.01) {
      this.mesh.material.opacity = targetOpacity;
      this.mesh.material.needsUpdate = true;
    }

    this.mesh.visible = targetOpacity > 0.05;
  }

  dispose() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
  }
}
