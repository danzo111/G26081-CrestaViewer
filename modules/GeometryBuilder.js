/**
 * GeometryBuilder.js — 3D Geometry Construction
 * 
 * Builds separate instanced meshes for Sewer and Stormwater manholes,
 * merged pipe geometry, ground plane, basemap, and drop lines.
 */

import * as THREE from 'three';
import { appState } from './AppState.js';

export class GeometryBuilder {
  constructor(sceneManager, coordSystem) {
    this.scene = sceneManager.scene;
    this.materials = sceneManager.materials;
    this.coordSystem = coordSystem;

    this.mhInstData = [];
    this.pipeData = [];
    this.N_MH = 0;
    this.N_PIPES = 0;
    this.PIPE_SEGMENTS = 12;

    // Colors for each type
    this.COL_SEWER = new THREE.Color(0xD4880F);      // Amber/Gold
    this.COL_STORM = new THREE.Color(0x00c8ff);      // Cyan
    this.COL_HOVER = new THREE.Color(0xF5EFE6);      // White-ish hover
    this.COL_PIPE_MH = new THREE.Color(0xD4B483);    // Amber highlight for pipe-connected
  }

  /**
   * Build manhole geometry using TWO separate instanced meshes:
   * - iCoversSewer: amber/gold covers for Sewer manholes
   * - iCoversStorm: cyan covers for Stormwater manholes
   * - iShafts: shared shaft mesh (dark blue for all)
   */
  buildManholes(manholes) {
    this.N_MH = manholes.length;

    // Separate arrays for each type
    const sewerIndices = [];
    const stormIndices = [];

    manholes.forEach((mh, i) => {
      if (mh.type === 'Sewer') sewerIndices.push(i);
      else stormIndices.push(i);
    });

    const geoCover = new THREE.CylinderGeometry(0.5, 0.5, 0.10, 16);
    const geoShaft = new THREE.CylinderGeometry(0.5, 0.5, 1.00, 12);

    // Create separate cover meshes for each type
    this.iCoversSewer = new THREE.InstancedMesh(geoCover, this.materials.coverSewer, sewerIndices.length || 1);
    this.iCoversStorm = new THREE.InstancedMesh(geoCover, this.materials.coverStorm, stormIndices.length || 1);
    this.iShafts = new THREE.InstancedMesh(geoShaft, this.materials.shaft, this.N_MH);

    this.iCoversSewer.castShadow = true; this.iCoversSewer.receiveShadow = true;
    this.iCoversStorm.castShadow = true; this.iCoversStorm.receiveShadow = true;
    this.iShafts.castShadow = true; this.iShafts.receiveShadow = true;

    this.iCoversSewer.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array((sewerIndices.length || 1) * 3).fill(1), 3);
    this.iCoversStorm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array((stormIndices.length || 1) * 3).fill(1), 3);

    // Track which mesh and local index each manhole belongs to
    this.mhMeshMap = new Array(this.N_MH); // { mesh: 'sewer'|'storm', localIndex: number }

    const dummy = new THREE.Object3D();
    let sewerLocalIdx = 0;
    let stormLocalIdx = 0;

    manholes.forEach((mh, i) => {
      const invertElev = mh.cover_elev - Math.max(mh.depth || 0, 0);
      const r = (mh.diameter || 1.0) / 2;
      const topS = this.coordSystem.w2s(mh.x, mh.y, mh.cover_elev);
      const botS = this.coordSystem.w2s(mh.x, mh.y, invertElev);
      const h = Math.max(topS.y - botS.y, 0.05);

      const isSewer = mh.type === 'Sewer';
      const targetMesh = isSewer ? this.iCoversSewer : this.iCoversStorm;
      const localIdx = isSewer ? sewerLocalIdx++ : stormLocalIdx++;

      this.mhMeshMap[i] = { mesh: isSewer ? 'sewer' : 'storm', localIndex: localIdx };

      // Cover
      dummy.position.copy(topS);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(r * 2, 1, r * 2);
      dummy.updateMatrix();
      targetMesh.setMatrixAt(localIdx, dummy.matrix);
      targetMesh.setColorAt(localIdx, isSewer ? this.COL_SEWER : this.COL_STORM);

      // Shaft (shared mesh, uses global index i)
      dummy.position.set(topS.x, botS.y + h / 2, topS.z);
      dummy.scale.set(r * 2, h, r * 2);
      dummy.updateMatrix();
      this.iShafts.setMatrixAt(i, dummy.matrix);

      this.mhInstData[i] = {
        ...mh, invertElev, topS: topS.clone(), botS: botS.clone(),
        r, h, index: i
      };
    });

    this.iCoversSewer.instanceMatrix.needsUpdate = true;
    this.iCoversSewer.instanceColor.needsUpdate = true;
    this.iCoversStorm.instanceMatrix.needsUpdate = true;
    this.iCoversStorm.instanceColor.needsUpdate = true;
    this.iShafts.instanceMatrix.needsUpdate = true;

    this.scene.add(this.iCoversSewer, this.iCoversStorm, this.iShafts);

    appState.setMhInstData(this.mhInstData);

    return { 
      iCoversSewer: this.iCoversSewer, 
      iCoversStorm: this.iCoversStorm, 
      iShafts: this.iShafts, 
      mhInstData: this.mhInstData 
    };
  }

  /**
   * Set manhole cover color at index
   * @param {number} index - Manhole index
   * @param {THREE.Color} color - Target color
   */
  setManholeColor(index, color) {
    const map = this.mhMeshMap[index];
    if (!map) return;

    const mesh = map.mesh === 'sewer' ? this.iCoversSewer : this.iCoversStorm;
    mesh.setColorAt(map.localIndex, color);
    mesh.instanceColor.needsUpdate = true;
  }

  /**
   * Reset all manhole cover colors to their type defaults
   */
  resetManholeColors() {
    for (let i = 0; i < this.N_MH; i++) {
      const map = this.mhMeshMap[i];
      if (!map) continue;
      const mesh = map.mesh === 'sewer' ? this.iCoversSewer : this.iCoversStorm;
      const defaultColor = map.mesh === 'sewer' ? this.COL_SEWER : this.COL_STORM;
      mesh.setColorAt(map.localIndex, defaultColor);
    }
    this.iCoversSewer.instanceColor.needsUpdate = true;
    this.iCoversStorm.instanceColor.needsUpdate = true;
  }

  /**
   * Build all pipe geometry using merged meshes (one per type)
   */
  buildPipes(pipes, mhLookup) {
    this.N_PIPES = pipes.length;

    const stormVerts = [], stormIndices = [];
    const sewerVerts = [], sewerIndices = [];
    let stormOffset = 0, sewerOffset = 0;

    const pipeData = [];

    pipes.forEach((pipe, i) => {
      const fromMH = mhLookup[pipe.from_mh];
      const toMH = mhLookup[pipe.to_mh];

      if (!fromMH || !toMH) {
        appState.addError(`Pipe ${pipe.id || i}: orphaned reference`, 'GeometryBuilder');
        pipeData.push(null);
        return;
      }

      // A pipe-level "type" field overrides the endpoint-inferred classification
      const isStormwater = pipe.type
        ? pipe.type !== 'Sewer'
        : (fromMH.type === 'Stormwater' || toMH.type === 'Stormwater');
      const verts = isStormwater ? stormVerts : sewerVerts;
      const indices = isStormwater ? stormIndices : sewerIndices;
      let offset = isStormwater ? stormOffset : sewerOffset;

      const fromInvert = fromMH.cover_elev - pipe.from_depth;
      const toInvert = toMH.cover_elev - pipe.to_depth;
      const p1 = this.coordSystem.w2s(fromMH.x, fromMH.y, fromInvert);
      const p2 = this.coordSystem.w2s(toMH.x, toMH.y, toInvert);

      const dir = new THREE.Vector3().subVectors(p2, p1);
      const length = Math.max(dir.length(), 0.05);
      const rp = (pipe.diameter_mm / 1000);  // 2× visual size for visibility
      const norm = dir.clone().normalize();

      const up = new THREE.Vector3(0, 1, 0);
      let right, forward;

      if (Math.abs(norm.dot(up)) > 0.999) {
        right = new THREE.Vector3(1, 0, 0);
        forward = new THREE.Vector3(0, 0, 1);
      } else {
        right = new THREE.Vector3().crossVectors(up, norm).normalize();
        forward = new THREE.Vector3().crossVectors(norm, right).normalize();
      }

      const baseIdx = offset;
      for (let s = 0; s <= this.PIPE_SEGMENTS; s++) {
        const angle = (s / this.PIPE_SEGMENTS) * Math.PI * 2;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const offsetVec = new THREE.Vector3()
          .addScaledVector(right, cos * rp)
          .addScaledVector(forward, sin * rp);

        verts.push(p1.x + offsetVec.x, p1.y + offsetVec.y, p1.z + offsetVec.z);
        verts.push(p2.x + offsetVec.x, p2.y + offsetVec.y, p2.z + offsetVec.z);
      }

      for (let s = 0; s < this.PIPE_SEGMENTS; s++) {
        const tl = baseIdx + s * 2;
        const tr = baseIdx + (s + 1) * 2;
        const bl = baseIdx + s * 2 + 1;
        const br = baseIdx + (s + 1) * 2 + 1;
        indices.push(tl, bl, tr, bl, br, tr);
      }

      verts.push(p1.x, p1.y, p1.z);
      const startCenter = baseIdx + (this.PIPE_SEGMENTS + 1) * 2;
      for (let s = 0; s < this.PIPE_SEGMENTS; s++) {
        indices.push(startCenter, baseIdx + s * 2, baseIdx + (s + 1) * 2);
      }

      verts.push(p2.x, p2.y, p2.z);
      const endCenter = startCenter + 1;
      for (let s = 0; s < this.PIPE_SEGMENTS; s++) {
        indices.push(endCenter, baseIdx + (s + 1) * 2 + 1, baseIdx + s * 2 + 1);
      }

      offset += (this.PIPE_SEGMENTS + 1) * 2 + 2;

      if (isStormwater) stormOffset = offset;
      else sewerOffset = offset;

      const elevDiff = toInvert - fromInvert;
      const grade = (elevDiff / length) * 100;
      const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);

      pipeData.push({
        ...pipe, fromInvert, toInvert,
        p1: p1.clone(), p2: p2.clone(), fromMH, toMH,
        rp, length, mid: mid.clone(), grade,
        fromIdx: this.mhInstData.findIndex(m => m.id === fromMH.id),
        toIdx: this.mhInstData.findIndex(m => m.id === toMH.id),
        isStormwater
      });
    });

    let stormMesh = null, sewerMesh = null;

    if (stormVerts.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(stormVerts, 3));
      geo.setIndex(stormIndices);
      geo.computeVertexNormals();
      stormMesh = new THREE.Mesh(geo, this.materials.pipeStorm);
      stormMesh.castShadow = true;
      stormMesh.receiveShadow = true;
      stormMesh.name = 'pipes_storm';
      this.scene.add(stormMesh);
    }

    if (sewerVerts.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(sewerVerts, 3));
      geo.setIndex(sewerIndices);
      geo.computeVertexNormals();
      sewerMesh = new THREE.Mesh(geo, this.materials.pipeSewer);
      sewerMesh.castShadow = true;
      sewerMesh.receiveShadow = true;
      sewerMesh.name = 'pipes_sewer';
      this.scene.add(sewerMesh);
    }

    this.stormMesh = stormMesh;
    this.sewerMesh = sewerMesh;
    this.pipeData = pipeData;
    appState.setPipeData(pipeData);

    return { pipeData, stormMesh, sewerMesh };
  }

  /**
   * Highlight a specific pipe by creating a very visible overlay mesh.
   * Uses bright emissive color and full opacity for clear visual feedback.
   */
  setPipeHighlight(index) {
    this.clearPipeHighlight();
    const pd = this.pipeData[index];
    if (!pd) return null;

    const dir = new THREE.Vector3().subVectors(pd.p2, pd.p1);
    const len = Math.max(dir.length(), 0.05);
    const rp = pd.rp * 2.2;  // MUCH thicker than original pipe

    // Bright highlight material — full opacity, strong emissive
    const highlightMat = new THREE.MeshStandardMaterial({
      color: pd.isStormwater ? 0x88ccff : 0xffdd44,
      emissive: pd.isStormwater ? 0x0044aa : 0xaa6600,
      emissiveIntensity: 2.0,
      roughness: 0.2,
      metalness: 0.5,
      transparent: false,
      opacity: 1.0,
      side: THREE.DoubleSide
    });

    const geo = new THREE.CylinderGeometry(rp, rp, len, 16);
    const mesh = new THREE.Mesh(geo, highlightMat);
    mesh.position.copy(pd.mid);

    const up = new THREE.Vector3(0, 1, 0);
    const norm = dir.clone().normalize();

    if (Math.abs(norm.dot(up)) < 0.9999) {
      mesh.quaternion.setFromUnitVectors(up, norm);
    } else if (norm.y < 0) {
      mesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    }

    mesh.name = 'pipe_highlight';
    this.scene.add(mesh);
    this._activePipeHighlight = mesh;

    return mesh;
  }

  clearPipeHighlight() {
    if (this._activePipeHighlight) {
      this.scene.remove(this._activePipeHighlight);
      this._activePipeHighlight.geometry?.dispose();
      this._activePipeHighlight.material?.dispose();
      this._activePipeHighlight = null;
    }
  }

  buildDropLines(manholes) {
    const pts = [];
    manholes.forEach(mh => {
      const topS = this.coordSystem.w2s(mh.x, mh.y, mh.cover_elev);
      pts.push(topS.x, this.coordSystem.groundSceneY, topS.z);
      pts.push(topS.x, topS.y, topS.z);
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(geo, this.materials.drop);
    lines.name = 'droplines';
    this.scene.add(lines);

    return lines;
  }

  buildGround() {
    const bounds = this.coordSystem.basemapBounds;
    const boundsW = bounds.right - bounds.left;
    const boundsH = bounds.top - bounds.bottom;
    const size = Math.max(boundsW, boundsH) * 1.2 + 40;

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      this.materials.ground
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = this.coordSystem.groundSceneY;
    plane.receiveShadow = true;
    plane.name = 'ground_plane';
    this.scene.add(plane);

    const divs = Math.min(Math.ceil(size / 15), 50);
    const grid = new THREE.GridHelper(size, divs, 0xD4B483, 0xD4B483);
    grid.material.transparent = true;
    grid.material.opacity = 0.40;
    grid.position.y = this.coordSystem.groundSceneY + 0.01;
    grid.name = 'ground_grid';
    this.scene.add(grid);

    return { plane, grid };
  }

  buildBasemap(texture) {
    texture.rotation = Math.PI;
    texture.center.set(0.5, 0.5);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;

    const bounds = this.coordSystem.basemapBounds;
    const boundsW = bounds.right - bounds.left;
    const boundsH = bounds.top - bounds.bottom;
    const centerS = this.coordSystem.getBasemapCenter();

    const basemapMat = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      opacity: 0.85,
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });

    const basemapPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(boundsW, boundsH),
      basemapMat
    );
    basemapPlane.rotation.x = -Math.PI / 2;
    basemapPlane.position.set(
      centerS.x, 
      this.coordSystem.basemapElev - this.coordSystem.originElev, 
      centerS.z
    );
    basemapPlane.name = 'basemap';
    basemapPlane.receiveShadow = true;
    basemapPlane.renderOrder = -100;  // Draw behind all map elements
    this.scene.add(basemapPlane);

    const grid = this.scene.getObjectByName('ground_grid');
    const plane = this.scene.getObjectByName('ground_plane');
    if (grid) grid.visible = false;
    if (plane) plane.material.opacity = 0.05;

    return basemapPlane;
  }

  /**
   * Build the DXF reference overlay — exact CAD linework drawn as crisp
   * colour-coded line segments. Stored as one THREE.LineSegments per
   * discipline inside a group named 'dxf_overlay'. Hidden by default;
   * toggled from the map-view controls.
   * @param {Object} overlayData - { groups: { Sewer:[[x1,y1,x2,y2],...], ... } }
   * @returns {THREE.Group}
   */
  buildDxfOverlay(overlayData) {
    const colors = {
      Sewer: 0xE87722,
      Stormwater: 0x00D4FF,
      Water: 0x0A3D91,
      Unknown: 0xFFFFFF
    };
    const group = new THREE.Group();
    group.name = 'dxf_overlay';
    // sit just above the basemap so it reads as a reference under the network
    const elev = this.coordSystem.basemapElev + 3.0;
    const groups = overlayData.groups || {};

    for (const disc of Object.keys(groups)) {
      const segs = groups[disc];
      if (!segs || !segs.length) continue;
      const positions = new Float32Array(segs.length * 6);
      let i = 0;
      for (const s of segs) {
        const a = this.coordSystem.w2s(s[0], s[1], elev);
        const b = this.coordSystem.w2s(s[2], s[3], elev);
        positions[i++] = a.x; positions[i++] = a.y; positions[i++] = a.z;
        positions[i++] = b.x; positions[i++] = b.y; positions[i++] = b.z;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: colors[disc] ?? 0xffffff,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false
      });
      const lines = new THREE.LineSegments(geo, mat);
      lines.name = 'dxf_overlay_' + disc;
      lines.renderOrder = -50; // above basemap (-100), below network (0)
      group.add(lines);
    }

    group.visible = false; // off by default; toggled in the map view
    this.scene.add(group);
    this.dxfOverlay = group;
    return group;
  }

  createManholeHighlight(mh) {
    const geo = new THREE.CylinderGeometry(mh.r * 1.08, mh.r * 1.08, 0.14, 20);
    const mesh = new THREE.Mesh(geo, this.materials.highlight);
    mesh.position.copy(mh.topS);
    return mesh;
  }

  createPipeHighlight(pd) {
    // DEPRECATED: Use setPipeHighlight(index) for selection instead.
    // This creates a subtle preview highlight only.
    const dir = new THREE.Vector3().subVectors(pd.p2, pd.p1);
    const len = Math.max(dir.length(), 0.05);
    const rp = pd.rp * 1.4;

    const geo = new THREE.CylinderGeometry(rp, rp, len, 14);
    const mat = pd.isStormwater 
      ? this.materials.pipeHighlightStorm 
      : this.materials.pipeHighlightSewer;

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pd.mid);

    const up = new THREE.Vector3(0, 1, 0);
    const norm = dir.clone().normalize();

    if (Math.abs(norm.dot(up)) < 0.9999) {
      mesh.quaternion.setFromUnitVectors(up, norm);
    } else if (norm.y < 0) {
      mesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    }

    return mesh;
  }

  createConnectedHighlight(mh) {
    const geo = new THREE.CylinderGeometry(mh.r * 1.15, mh.r * 1.15, 0.16, 20);
    const mesh = new THREE.Mesh(geo, this.materials.connectedMh);
    mesh.position.copy(mh.topS);
    return mesh;
  }

  createMeasureMarker(position) {
    const geo = new THREE.SphereGeometry(0.3, 12, 12);
    const mesh = new THREE.Mesh(geo, this.materials.measureMarker);
    mesh.position.copy(position);
    mesh.position.y += 0.3;
    return mesh;
  }
}
