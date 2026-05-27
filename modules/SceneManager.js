/**
 * SceneManager.js — Three.js Scene Setup & Management
 * 
 * Encapsulates all Three.js initialization, lighting, materials,
 * and scene graph management. Clean separation from UI logic.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { appState } from './AppState.js';

export class SceneManager {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Container #${containerId} not found`);
    }

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.materials = {};
    this.meshes = {};

    this.init();
  }

  init() {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0xffffff, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // Camera
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 5000);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 2000;
    this.controls.maxPolarAngle = Math.PI * 0.88;
    this.controls.zoomSpeed = 0.8;
    this.controls.enableZoom = true;

    // Smooth zoom damping
    this._setupZoomDamping();

    // Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xe8e8e8, 0.0006);

    // Lighting
    this._setupLighting();

    // Materials
    this._setupMaterials();

    // Store references in appState
    appState.setScene(this.scene);
    appState.setRenderer(this.renderer);
    appState.setCamera(this.camera);
    appState.setControls(this.controls);

    // Resize handler
    this._setupResize();
  }

  _setupLighting() {
    this.scene.add(new THREE.AmbientLight(0x3a2a1a, 3.0));

    const sun = new THREE.DirectionalLight(0xf5efe6, 2.5);
    sun.position.set(60, 150, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 1000;
    sun.shadow.bias = -0.001;
    this.scene.add(sun);
    this.lights = { sun };

    const fill = new THREE.DirectionalLight(0x1C3557, 0.8);
    fill.position.set(-50, 40, -40);
    this.scene.add(fill);
    this.lights.fill = fill;

    const rim = new THREE.DirectionalLight(0xD4880F, 0.3);
    rim.position.set(0, 20, -80);
    this.scene.add(rim);
    this.lights.rim = rim;
  }

  _setupMaterials() {
    // TWO separate cover materials: Sewer (amber) and Stormwater (cyan)
    this.materials.coverSewer = new THREE.MeshStandardMaterial({
      color: 0xD4880F, emissive: 0x1a0f00, roughness: 0.25, 
      metalness: 0.85, envMapIntensity: 1.0
    });

    this.materials.coverStorm = new THREE.MeshStandardMaterial({
      color: 0x00c8ff, emissive: 0x001a22, roughness: 0.25, 
      metalness: 0.85, envMapIntensity: 1.0
    });

    // Shared shaft material (navy blue for all)
    this.materials.shaft = new THREE.MeshStandardMaterial({
      color: 0x1C3557, roughness: 0.65, metalness: 0.25
    });

    // Pipe materials
    this.materials.pipeStorm = new THREE.MeshStandardMaterial({
      color: 0x4A90D9, emissive: 0x0a1a30, roughness: 0.45, metalness: 0.35
    });

    this.materials.pipeSewer = new THREE.MeshStandardMaterial({
      color: 0xD4880F, emissive: 0x1a0f00, roughness: 0.45, metalness: 0.35
    });

    this.materials.drop = new THREE.LineBasicMaterial({
      color: 0xD4B483, transparent: true, opacity: 0.25
    });

    // Selection highlight (bright cyan)
    this.materials.highlight = new THREE.MeshStandardMaterial({
      color: 0x00ffff, emissive: 0x0088aa, roughness: 0.2, 
      metalness: 0.9, transparent: true, opacity: 0.85
    });

    // Pipe highlights
    this.materials.pipeHighlightStorm = new THREE.MeshStandardMaterial({
      color: 0x66b3ff, emissive: 0x002244, roughness: 0.35, 
      metalness: 0.4, transparent: true, opacity: 0.80
    });

    this.materials.pipeHighlightSewer = new THREE.MeshStandardMaterial({
      color: 0xFFEB3B, emissive: 0x332200, roughness: 0.35, 
      metalness: 0.4, transparent: true, opacity: 0.80
    });

    // Connected manhole glow (amber)
    this.materials.connectedMh = new THREE.MeshStandardMaterial({
      color: 0xFFEB3B, emissive: 0x332200, roughness: 0.2, 
      metalness: 0.9, transparent: true, opacity: 0.6
    });

    this.materials.ground = new THREE.MeshStandardMaterial({
      color: 0x1C3557, transparent: true, opacity: 0.30, 
      roughness: 1, side: THREE.DoubleSide
    });

    this.materials.measureMarker = new THREE.MeshStandardMaterial({
      color: 0xD4880F, emissive: 0x332200
    });
  }

  _setupZoomDamping() {
    const origUpdate = this.controls.update.bind(this.controls);

    this.controls.update = () => {
      const dist = this.camera.position.distanceTo(this.controls.target);
      const factor = Math.max(0.15, Math.min(1.0, dist / 30));
      this.controls.zoomSpeed = 0.99 * factor;
      return origUpdate();
    };
  }

  _setupResize() {
    const onResize = () => {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };

    window.addEventListener('resize', onResize);
    onResize();
  }

  frameCamera(box, zoomFactor = 0.5) {
    const centre = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(centre);
    box.getSize(size);
    const span = Math.max(size.length(), 1);

    this.camera.position.set(
      centre.x + span * 0.50,
      centre.y + span * 0.45,
      centre.z + span * 0.65
    );
    this.controls.target.copy(centre);
    this.controls.update();

    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    this.camera.position.copy(this.controls.target).add(dir.multiplyScalar(zoomFactor));
    this.controls.update();
  }

  animateCamera(targetPos, targetLook, duration = 800) {
    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const startTime = performance.now();

    const animate = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);

      this.camera.position.lerpVectors(startPos, targetPos, ease);
      this.controls.target.lerpVectors(startTarget, targetLook, ease);
      this.controls.update();

      if (t < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }

  getViewPosition(viewName, box) {
    const centre = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(centre);
    box.getSize(size);
    const span = Math.max(size.length(), 1);
    const dist = span * 0.85;

    switch(viewName) {
      case 'top': return new THREE.Vector3(centre.x, centre.y + dist, centre.z);
      case 'front': return new THREE.Vector3(centre.x, centre.y, centre.z + dist);
      case 'back': return new THREE.Vector3(centre.x, centre.y, centre.z - dist);
      case 'right': return new THREE.Vector3(centre.x + dist, centre.y, centre.z);
      case 'left': return new THREE.Vector3(centre.x - dist, centre.y, centre.z);
      case 'iso':
      default: return new THREE.Vector3(
        centre.x + dist * 0.6, 
        centre.y + dist * 0.55, 
        centre.z + dist * 0.6
      );
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);

    Object.values(this.materials).forEach(mat => mat.dispose());
    Object.values(this.meshes).forEach(mesh => {
      if (mesh.geometry) mesh.geometry.dispose();
      this.scene.remove(mesh);
    });
  }
}