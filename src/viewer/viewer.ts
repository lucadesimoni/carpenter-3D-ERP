// 3D-Ansicht: Szene, Bauteil-Meshes, Explosionsansicht, Montage-Animation,
// Bauteil-Auswahl, Bemassung, ViewCube, Messen, Schnittansicht,
// orthogonale Projektion und Zeitleisten-Sichtbarkeit.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { snapAxis } from '../core/snapping';
import { csgSolid, isSolidReady } from '../core/solid';
import { getBoreMaterial, getMetalMaterial, getWoodMaterial } from '../core/wood';
import { ViewCube } from './viewcube';
import type { Assembly, PartSpec } from '../core/types';

export type ViewPreset = 'iso' | 'front' | 'side' | 'top';
export type SectionAxis = 'x' | 'y' | 'z';

export interface MeasureResult {
  distance: number;
  dx: number;
  dy: number;
  dz: number;
}

export interface ViewerCallbacks {
  onSelect: (part: PartSpec | null) => void;
  /** 3D-Verschiebung eines Teils beendet (Delta in mm, bereits gerundet) */
  onTransform: (partId: string, delta: [number, number, number]) => void;
  /** Grösse per Gizmo geändert (Press/Pull), neue Achsmasse + Versatz (Gegenfläche bleibt fest) */
  onResize?: (partId: string, size: [number, number, number], move: [number, number, number]) => void;
  /** Rechtsklick auf ein Teil (oder Leerraum), Bildschirmkoordinaten */
  onContextMenu?: (part: PartSpec | null, x: number, y: number) => void;
  onAnimationEnd: () => void;
  /** Fortschritt der Montage-Animation in Stufen (0 … stepCount) */
  onAnimationProgress: (step: number) => void;
  /** null = Messung zurückgesetzt / erster Punkt gesetzt */
  onMeasure: (result: MeasureResult | null) => void;
}

const STEP_DURATION = 0.85; // Sekunden pro Montagestufe
const ANIM_START_FACTOR = 1.6; // Explosionsweite, aus der Teile "einfliegen"

interface OverlayLabel {
  el: HTMLDivElement;
  anchor: THREE.Vector3;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private persp: THREE.PerspectiveCamera;
  private ortho: THREE.OrthographicCamera;
  private camera: THREE.Camera;
  private controls: OrbitControls;
  private viewCube: ViewCube;

  private partsGroup = new THREE.Group();
  private dimGroup = new THREE.Group();
  private measureGroup = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private assembly: Assembly | null = null;
  private bounds = new THREE.Box3();
  private ground: THREE.Mesh;
  private grid: THREE.GridHelper;

  private explodeFactor = 0;
  private animating = false;
  private animTime = 0;
  private timelineStep: number | null = null;

  private dimsVisible = false;
  private dimLabels: OverlayLabel[] = [];

  private measureMode = false;
  private measurePoints: THREE.Vector3[] = [];
  private measureLabels: OverlayLabel[] = [];

  private clipPlanes: THREE.Plane[] = [];
  private sectionHelper: THREE.Mesh | null = null;

  private selected: THREE.Mesh | null = null;
  private selectedOriginalMaterial: THREE.Material | null = null;
  private hovered: THREE.Mesh | null = null;
  private hoveredOriginalMaterial: THREE.Material | null = null;
  private raycaster = new THREE.Raycaster();
  private pointerDownPos: { x: number; y: number } | null = null;

  private cameraTween: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null;
  private gizmo: TransformControls | null = null;
  private moveMode = false;
  private resizeMode = false;
  private dragStart = new THREE.Vector3();
  private snapGrid = 5;
  private snapToPart = true;

  private clock = new THREE.Clock();
  private disposed = false;

  constructor(
    private container: HTMLElement,
    private labelLayer: HTMLElement,
    viewCubeEl: HTMLElement,
    private callbacks: ViewerCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: true, // Hintergrund-Verlauf kommt per CSS aus dem Container
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.persp = new THREE.PerspectiveCamera(45, 1, 5, 40000);
    this.persp.position.set(900, 620, 1150);
    this.ortho = new THREE.OrthographicCamera(-1000, 1000, 1000, -1000, -20000, 40000);
    this.camera = this.persp;

    this.controls = new OrbitControls(this.persp, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.72;
    this.controls.minDistance = 250;
    this.controls.maxDistance = 9000;

    // Licht: Hauptlicht mit Schatten + weiches Gegenlicht
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1400, 2200, 1600);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -1600;
    sun.shadow.camera.right = 1600;
    sun.shadow.camera.top = 1600;
    sun.shadow.camera.bottom = -1600;
    sun.shadow.camera.far = 8000;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5);
    fill.position.set(-1200, 800, -900);
    this.scene.add(fill);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.25));

    // Boden: nur Schatten (Möbel "schwebt" wie ein montierter Hängeschrank) + dezentes Raster
    this.ground = new THREE.Mesh(
      new THREE.CircleGeometry(6000, 64),
      new THREE.ShadowMaterial({ opacity: 0.22 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.grid = new THREE.GridHelper(4000, 40, 0xa8b2c0, 0xc2cad5);
    const gridMat = this.grid.material as THREE.LineBasicMaterial;
    gridMat.transparent = true;
    gridMat.opacity = 0.45;
    this.scene.add(this.grid);

    this.scene.add(this.partsGroup);
    this.scene.add(this.dimGroup);
    this.scene.add(this.measureGroup);

    this.viewCube = new ViewCube(viewCubeEl, (dir) => this.snapToDirection(dir));

    // 3D-Verschieben: Gizmo (TransformControls) im Bewegen-Modus
    this.gizmo = new TransformControls(this.persp, this.renderer.domElement);
    this.gizmo.setMode('translate');
    this.gizmo.addEventListener('objectChange', () => {
      const obj = this.gizmo?.object as THREE.Mesh | undefined;
      if (!obj || !(this.gizmo as unknown as { dragging: boolean }).dragging) return;
      if (this.gizmo?.getMode() === 'translate') this.applySnapping(obj);
    });
    this.gizmo.addEventListener('dragging-changed', (e) => {
      const dragging = (e as unknown as { value: boolean }).value;
      this.controls.enabled = !dragging;
      const obj = this.gizmo?.object as THREE.Mesh | undefined;
      if (!obj) return;
      const scaleMode = this.gizmo?.getMode() === 'scale';
      if (dragging) {
        this.dragStart.copy(obj.position);
      } else if (scaleMode) {
        // Press/Pull: Skalierung in neue Achsmasse umrechnen; Gegenfläche bleibt
        // fest, indem das Teil um das halbe Delta in Ziehrichtung versetzt wird.
        const part = obj.userData.part as PartSpec;
        const base = this.effectiveSize(part).map((s) => Math.round(s)) as [number, number, number];
        const size: [number, number, number] = [
          Math.max(3, Math.round(base[0] * obj.scale.x)),
          Math.max(3, Math.round(base[1] * obj.scale.y)),
          Math.max(3, Math.round(base[2] * obj.scale.z)),
        ];
        const move: [number, number, number] = [
          Math.round((size[0] - base[0]) / 2),
          Math.round((size[1] - base[1]) / 2),
          Math.round((size[2] - base[2]) / 2),
        ];
        obj.scale.set(1, 1, 1);
        if (size.some((v, i) => v !== base[i])) this.callbacks.onResize?.(part.id, size, move);
      } else {
        const delta: [number, number, number] = [
          Math.round(obj.position.x - this.dragStart.x),
          Math.round(obj.position.y - this.dragStart.y),
          Math.round(obj.position.z - this.dragStart.z),
        ];
        if (delta.some((d) => d !== 0)) {
          this.callbacks.onTransform((obj.userData.part as PartSpec).id, delta);
        }
      }
    });
    this.scene.add(this.gizmo.getHelper());

    window.addEventListener('resize', this.handleResize);
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.addEventListener('contextmenu', this.handleContextMenu);

    this.handleResize();
    this.renderer.setAnimationLoop(this.tick);
  }

  // ------------------------------------------------------------------ Aufbau

  setAssembly(assembly: Assembly): void {
    this.gizmo?.detach();
    this.select(null);
    this.clearMeasure();
    this.disposeParts();
    this.assembly = assembly;
    this.timelineStep = null;

    for (const part of assembly.parts) {
      const mesh = this.createMesh(part);
      this.partsGroup.add(mesh);
      this.meshes.push(mesh);
    }

    this.bounds.setFromPoints(
      assembly.parts.flatMap((p) => {
        const [sx, sy, sz] = this.effectiveSize(p);
        const [x, y, z] = p.position;
        return [
          new THREE.Vector3(x - sx / 2, y - sy / 2, z - sz / 2),
          new THREE.Vector3(x + sx / 2, y + sy / 2, z + sz / 2),
        ];
      }),
    );

    // Boden so tief legen, dass auch die volle Explosion nichts durchstösst
    const groundY = this.bounds.min.y - this.baseDistance() * 1.5;
    this.ground.position.y = groundY;
    this.grid.position.y = groundY + 1;

    this.applyClipPlanes();
    this.rebuildDimensions();
    this.applyOffsets();
    this.updateVisibility();
  }

  /** Achsen-korrigierte Bounding-Grösse (Zylinder liegen ggf. quer) */
  private effectiveSize(part: PartSpec): [number, number, number] {
    if (part.shape === 'cylinder') {
      const d = part.size[0];
      const len = part.size[1];
      if (part.axis === 'x') return [len, d, d];
      if (part.axis === 'z') return [d, d, len];
      return [d, len, d];
    }
    return part.size;
  }

  private createMesh(part: PartSpec): THREE.Mesh {
    let geometry: THREE.BufferGeometry;
    let csgHoles = false;
    const needsCsg =
      part.shape === 'box' &&
      isSolidReady() &&
      ((part.holes && part.holes.length > 0) || (part.chamfer !== undefined && part.chamfer > 0));
    const holeGeo = needsCsg ? this.holeGeometry(part) : null;
    if (part.shape === 'mesh' && part.mesh) {
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(part.mesh.position, 3));
      geometry.setIndex(new THREE.BufferAttribute(part.mesh.index, 1));
      geometry = geometry.toNonIndexed();
      geometry.computeVertexNormals();
      csgHoles = true; // wie CSG: keine Kanten-Overlays
    } else if (part.shape === 'cylinder') {
      geometry = new THREE.CylinderGeometry(part.size[0] / 2, part.size[0] / 2, part.size[1], 24);
    } else if (holeGeo) {
      // echte Bohrungen (CSG-Ausschnitte) via Manifold-WASM
      geometry = holeGeo;
      csgHoles = true;
    } else if (part.chamfer && part.chamfer > 0) {
      // Gebrochene/gefaste Kanten (JoinerCAD «Kante brechen») via RoundedBoxGeometry
      const r = Math.min(part.chamfer, ...part.size.map((s) => s / 2 - 0.5));
      geometry = new RoundedBoxGeometry(part.size[0], part.size[1], part.size[2], 3, Math.max(0.5, r));
    } else {
      geometry = new THREE.BoxGeometry(...part.size);
      // UV auf mm-Massstab bringen, damit die Holztextur nicht je Teil skaliert
      const uv = geometry.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) * 1.4, uv.getY(i) * 1.4);
      }
    }

    const material =
      part.materialKey === 'metal'
        ? getMetalMaterial()
        : part.materialKey === 'bore'
          ? getBoreMaterial()
          : getWoodMaterial(part.materialKey, part.grain);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    if (part.shape === 'cylinder') {
      if (part.axis === 'x') mesh.rotation.z = Math.PI / 2;
      else if (part.axis === 'z') mesh.rotation.x = Math.PI / 2;
    } else if (!part.chamfer && !csgHoles) {
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0x3a3f47, transparent: true, opacity: 0.28 }),
      );
      mesh.add(edges);
    }

    mesh.userData.part = part;
    mesh.userData.home = new THREE.Vector3(...part.position);
    mesh.userData.userVisible = true;
    return mesh;
  }

  /** Plattenkörper mit echter Fase (Verrundung) und Bohrungen (CSG) → Three-Geometrie. */
  private holeGeometry(part: PartSpec): THREE.BufferGeometry | null {
    const raw = csgSolid(part.size, part.holes ?? [], part.chamfer ?? 0);
    if (!raw) return null;
    let geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(raw.position, 3));
    geometry.setIndex(new THREE.BufferAttribute(raw.index, 1));
    geometry = geometry.toNonIndexed(); // flache Flächen (kein Verrunden an Kanten)
    geometry.computeVertexNormals();
    // Einfache planare UVs auf der Sichtfläche (dünnste Achse ausgeblendet)
    const thin = part.size.indexOf(Math.min(...part.size));
    const [ua, ub] = thin === 0 ? [1, 2] : thin === 1 ? [0, 2] : [0, 1];
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getComponent(i, ua) / 200;
      uv[i * 2 + 1] = pos.getComponent(i, ub) / 200;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geometry;
  }

  private disposeParts(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      for (const child of mesh.children) {
        if (child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      }
    }
    this.partsGroup.clear();
    this.meshes = [];
  }

  // -------------------------------------------------- Explosion & Animation

  setExplode(factor: number): void {
    this.explodeFactor = factor;
    if (!this.animating) this.applyOffsets();
  }

  get isAnimating(): boolean {
    return this.animating;
  }

  playAnimation(): void {
    if (!this.assembly) return;
    this.setTimelineStep(null);
    this.animating = true;
    this.animTime = 0;
  }

  stopAnimation(): void {
    this.animating = false;
    this.applyOffsets();
  }

  private baseDistance(): number {
    const size = this.bounds.getSize(new THREE.Vector3());
    return Math.max(size.x, size.y, size.z) * 0.38;
  }

  private applyOffsets(): void {
    if (!this.assembly) return;
    const base = this.baseDistance();
    const total = this.assembly.stepCount * STEP_DURATION;

    for (const mesh of this.meshes) {
      const part = mesh.userData.part as PartSpec;
      const home = mesh.userData.home as THREE.Vector3;

      let factor: number;
      if (this.animating) {
        const start = (part.step - 1) * STEP_DURATION;
        const p = Math.min(1, Math.max(0, (this.animTime - start) / STEP_DURATION));
        factor = ANIM_START_FACTOR * (1 - easeInOutCubic(p));
      } else {
        factor = this.explodeFactor;
      }

      mesh.position.set(
        home.x + part.explodeDir[0] * base * part.explodeScale * factor,
        home.y + part.explodeDir[1] * base * part.explodeScale * factor,
        home.z + part.explodeDir[2] * base * part.explodeScale * factor,
      );
    }

    if (this.animating) {
      this.callbacks.onAnimationProgress(
        Math.min(this.assembly.stepCount, this.animTime / STEP_DURATION),
      );
      if (this.animTime > total + 0.4) {
        this.animating = false;
        this.explodeFactor = 0;
        this.callbacks.onAnimationEnd();
      }
    }
  }

  // -------------------------------------------------------------- Zeitleiste

  /** null = alle Stufen sichtbar; n = nur Teile bis Montagestufe n */
  setTimelineStep(step: number | null): void {
    this.timelineStep = step;
    this.updateVisibility();
  }

  setPartVisible(id: string, visible: boolean): void {
    const mesh = this.meshes.find((m) => (m.userData.part as PartSpec).id === id);
    if (!mesh) return;
    mesh.userData.userVisible = visible;
    if (!visible && mesh === this.selected) this.select(null);
    this.updateVisibility();
  }

  private updateVisibility(): void {
    for (const mesh of this.meshes) {
      const part = mesh.userData.part as PartSpec;
      const stepOk = this.timelineStep === null || part.step <= this.timelineStep;
      mesh.visible = mesh.userData.userVisible !== false && stepOk;
    }
  }

  // ------------------------------------------------------------ Bemassung

  setDimensionsVisible(visible: boolean): void {
    this.dimsVisible = visible;
    this.rebuildDimensions();
  }

  private clearDimensions(): void {
    this.dimGroup.traverse((obj) => {
      if (obj instanceof THREE.Line) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    this.dimGroup.clear();
    for (const label of this.dimLabels) label.el.remove();
    this.dimLabels = [];
  }

  private rebuildDimensions(): void {
    this.clearDimensions();
    if (!this.dimsVisible || !this.assembly) return;

    const { min, max } = this.bounds;
    const off = 70; // Abstand der Masslinie vom Bauteil
    const { width, height, depth } = this.assembly.overall;

    // Breite: unten vorne
    this.addDimension(
      new THREE.Vector3(min.x, min.y - off, max.z),
      new THREE.Vector3(max.x, min.y - off, max.z),
      [new THREE.Vector3(min.x, min.y, max.z), new THREE.Vector3(max.x, min.y, max.z)],
      `${width} mm`,
    );
    // Höhe: rechts vorne
    this.addDimension(
      new THREE.Vector3(max.x + off, min.y, max.z),
      new THREE.Vector3(max.x + off, max.y, max.z),
      [new THREE.Vector3(max.x, min.y, max.z), new THREE.Vector3(max.x, max.y, max.z)],
      `${height} mm`,
    );
    // Tiefe: unten rechts
    this.addDimension(
      new THREE.Vector3(max.x + off, min.y - off, min.z),
      new THREE.Vector3(max.x + off, min.y - off, max.z),
      [new THREE.Vector3(max.x, min.y, min.z), new THREE.Vector3(max.x, min.y, max.z)],
      `${depth} mm`,
    );
  }

  private addDimension(
    a: THREE.Vector3,
    b: THREE.Vector3,
    extFrom: THREE.Vector3[],
    text: string,
  ): void {
    const material = new THREE.LineBasicMaterial({ color: 0x33415c });
    const points: THREE.Vector3[] = [a, b];
    // Hilfslinien vom Bauteil zur Masslinie
    points.push(extFrom[0], a, extFrom[1], b);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.LineSegments(geometry, material);
    this.dimGroup.add(line);
    this.dimLabels.push(this.makeLabel(text, a.clone().lerp(b, 0.5), 'dim-label'));
  }

  private makeLabel(text: string, anchor: THREE.Vector3, className: string): OverlayLabel {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    this.labelLayer.appendChild(el);
    return { el, anchor };
  }

  private updateLabels(): void {
    const rect = this.container.getBoundingClientRect();
    const v = new THREE.Vector3();
    for (const label of [...this.dimLabels, ...this.measureLabels]) {
      v.copy(label.anchor).project(this.camera as THREE.PerspectiveCamera);
      const visible = v.z < 1;
      label.el.style.display = visible ? 'block' : 'none';
      if (visible) {
        label.el.style.left = `${(v.x * 0.5 + 0.5) * rect.width}px`;
        label.el.style.top = `${(-v.y * 0.5 + 0.5) * rect.height}px`;
      }
    }
  }

  // ---------------------------------------------------------------- Messen

  setMeasureMode(on: boolean): void {
    this.measureMode = on;
    this.clearMeasure();
  }

  clearMeasure(): void {
    this.measureGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    this.measureGroup.clear();
    for (const label of this.measureLabels) label.el.remove();
    this.measureLabels = [];
    this.measurePoints = [];
    this.callbacks.onMeasure(null);
  }

  private addMeasurePoint(point: THREE.Vector3): void {
    if (this.measurePoints.length >= 2) this.clearMeasure();
    this.measurePoints.push(point.clone());

    const r = Math.max(4, this.baseDistance() * 0.02);
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(r, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xf7941e }),
    );
    marker.position.copy(point);
    this.measureGroup.add(marker);

    if (this.measurePoints.length === 2) {
      const [a, b] = this.measurePoints;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineBasicMaterial({ color: 0xf7941e }),
      );
      this.measureGroup.add(line);
      const d = a.distanceTo(b);
      this.measureLabels.push(
        this.makeLabel(`${d.toFixed(1)} mm`, a.clone().lerp(b, 0.5), 'measure-label'),
      );
      this.callbacks.onMeasure({
        distance: d,
        dx: Math.abs(b.x - a.x),
        dy: Math.abs(b.y - a.y),
        dz: Math.abs(b.z - a.z),
      });
    }
  }

  // --------------------------------------------------------------- Schnitt

  /** t in [0,1] entlang der Achse; enabled=false hebt den Schnitt auf */
  setSection(enabled: boolean, axis: SectionAxis, t: number): void {
    if (this.sectionHelper) {
      this.sectionHelper.geometry.dispose();
      (this.sectionHelper.material as THREE.Material).dispose();
      this.scene.remove(this.sectionHelper);
      this.sectionHelper = null;
    }

    if (!enabled || !this.assembly) {
      this.clipPlanes = [];
      this.applyClipPlanes();
      return;
    }

    const pad = 30;
    const min = this.bounds.min[axis] - pad;
    const max = this.bounds.max[axis] + pad;
    const cut = min + (max - min) * t;
    const normal = new THREE.Vector3(
      axis === 'x' ? -1 : 0,
      axis === 'y' ? -1 : 0,
      axis === 'z' ? -1 : 0,
    );
    // Behalten wird die Seite unterhalb des Schnittwerts (n·p + c >= 0)
    this.clipPlanes = [new THREE.Plane(normal, cut)];
    this.applyClipPlanes();

    // Halbtransparente Schnittebene als Orientierung
    const size = this.bounds.getSize(new THREE.Vector3()).length() * 0.8;
    const helper = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({
        color: 0x0696d7,
        transparent: true,
        opacity: 0.07,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const center = this.bounds.getCenter(new THREE.Vector3());
    helper.position.copy(center);
    helper.position[axis] = cut;
    if (axis === 'x') helper.rotation.y = Math.PI / 2;
    if (axis === 'y') helper.rotation.x = Math.PI / 2;
    this.sectionHelper = helper;
    this.scene.add(helper);
  }

  private applyClipPlanes(): void {
    for (const mesh of this.meshes) {
      const materials = [mesh.material as THREE.Material];
      for (const child of mesh.children) {
        if (child instanceof THREE.LineSegments) materials.push(child.material as THREE.Material);
      }
      for (const mat of materials) {
        mat.clippingPlanes = this.clipPlanes;
        mat.clipShadows = true;
      }
    }
  }

  // ------------------------------------------------------------- Interaktion

  private handleContextMenu = (e: MouseEvent): void => {
    if (!this.callbacks.onContextMenu) return;
    e.preventDefault();
    this.raycaster.setFromCamera(this.toNdc(e as unknown as PointerEvent), this.camera as THREE.PerspectiveCamera);
    const hits = this.raycaster.intersectObjects(this.visibleMeshes(), false);
    const part = hits.length > 0 ? (hits[0].object.userData.part as PartSpec) : null;
    if (part) this.selectPart(part.id);
    this.callbacks.onContextMenu(part, e.clientX, e.clientY);
  };

  private handlePointerDown = (e: PointerEvent): void => {
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (this.pointerDownPos) return; // während Kamerabewegung nicht raycasten
    this.raycaster.setFromCamera(this.toNdc(e), this.camera as THREE.PerspectiveCamera);
    const hits = this.raycaster.intersectObjects(this.visibleMeshes(), false);
    const hitMesh = hits.length > 0 ? (hits[0].object as THREE.Mesh) : null;
    this.renderer.domElement.style.cursor = hitMesh ? (this.measureMode ? 'crosshair' : 'pointer') : '';
    if (!this.measureMode) this.setHover(hitMesh);
  };

  /** Hover-Hervorhebung (nur bei Wechsel klonen) — macht die Bauteilwahl eindeutig. */
  private setHover(mesh: THREE.Mesh | null): void {
    if (mesh === this.hovered) return;
    if (this.hovered && this.hoveredOriginalMaterial && this.hovered !== this.selected) {
      (this.hovered.material as THREE.Material).dispose();
      this.hovered.material = this.hoveredOriginalMaterial;
    }
    this.hovered = mesh;
    this.hoveredOriginalMaterial = null;
    if (mesh && mesh !== this.selected) {
      const original = mesh.material as THREE.MeshStandardMaterial;
      this.hoveredOriginalMaterial = original;
      const hi = original.clone();
      hi.emissive = new THREE.Color(0x0696d7);
      hi.emissiveIntensity = 0.14;
      hi.clippingPlanes = this.clipPlanes;
      hi.clipShadows = true;
      mesh.material = hi;
    }
  }

  private visibleMeshes(): THREE.Mesh[] {
    return this.meshes.filter((m) => m.visible);
  }

  private toNdc(e: PointerEvent): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  private handlePointerUp = (e: PointerEvent): void => {
    if (!this.pointerDownPos) return;
    const moved =
      Math.abs(e.clientX - this.pointerDownPos.x) + Math.abs(e.clientY - this.pointerDownPos.y);
    this.pointerDownPos = null;
    if (moved > 6) return; // Drag = Kamerabewegung, keine Auswahl

    this.raycaster.setFromCamera(this.toNdc(e), this.camera as THREE.PerspectiveCamera);
    const hits = this.raycaster.intersectObjects(this.visibleMeshes(), false);

    if (this.measureMode) {
      if (hits.length > 0) this.addMeasurePoint(hits[0].point);
      return;
    }
    this.select(hits.length > 0 ? (hits[0].object as THREE.Mesh) : null);
  };

  /** Fangeinstellungen (Raster in mm, Bauteil-Fang an/aus) */
  setSnapOptions(grid: number, toPart: boolean): void {
    this.snapGrid = grid;
    this.snapToPart = toPart;
  }

  /** Bodenraster in der 3D-Ansicht ein-/ausblenden */
  setGridVisible(visible: boolean): void {
    this.grid.visible = visible;
  }

  /** Hintergrund-Stimmung; der Verlauf kommt per CSS aus dem Container (data-bg) */
  setBackground(mode: 'hell' | 'warm' | 'dunkel'): void {
    this.container.dataset.bg = mode;
  }

  /** Kanten-/Raster-Fang während des Gizmo-Ziehens */
  private applySnapping(obj: THREE.Mesh): void {
    const part = obj.userData.part as PartSpec;
    const size = this.effectiveSize(part);
    const tolerance = 7;
    const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
    axes.forEach((axis, i) => {
      const others = this.snapToPart
        ? this.meshes
            .filter((m) => m !== obj && m.visible)
            .map((m) => {
              const p = m.userData.part as PartSpec;
              const s = this.effectiveSize(p);
              return { min: m.position[axis] - s[i] / 2, max: m.position[axis] + s[i] / 2 };
            })
        : [];
      obj.position[axis] = snapAxis(obj.position[axis], size[i] / 2, others, this.snapGrid, tolerance);
    });
  }

  /** Bewegen-Modus: Gizmo (Verschieben) folgt der Auswahl */
  setMoveMode(on: boolean): void {
    this.moveMode = on;
    if (on) {
      this.resizeMode = false;
      this.gizmo?.setMode('translate');
    }
    this.syncGizmo();
  }

  /** Press/Pull-Modus: Gizmo (Skalieren/Grösse ziehen) folgt der Auswahl */
  setResizeMode(on: boolean): void {
    this.resizeMode = on;
    if (on) {
      this.moveMode = false;
      this.gizmo?.setMode('scale');
    } else {
      this.gizmo?.setMode('translate');
    }
    this.syncGizmo();
  }

  private syncGizmo(): void {
    if (!this.gizmo) return;
    if ((this.moveMode || this.resizeMode) && this.selected) this.gizmo.attach(this.selected);
    else this.gizmo.detach();
  }

  /** Auswahl von aussen (z.B. Klick im Browser-Baum) */
  selectPart(id: string | null): void {
    const mesh = id ? this.meshes.find((m) => (m.userData.part as PartSpec).id === id) : null;
    this.select(mesh ?? null);
  }

  private select(mesh: THREE.Mesh | null): void {
    this.setHover(null); // Hover-Klon zurücksetzen, damit das echte Material gesichert wird
    if (this.selected && this.selectedOriginalMaterial) {
      (this.selected.material as THREE.Material).dispose();
      this.selected.material = this.selectedOriginalMaterial;
    }
    this.selected = mesh;
    this.selectedOriginalMaterial = null;

    if (mesh) {
      const original = mesh.material as THREE.MeshStandardMaterial;
      this.selectedOriginalMaterial = original;
      const highlighted = original.clone();
      highlighted.emissive = new THREE.Color(0x0696d7);
      highlighted.emissiveIntensity = 0.35;
      highlighted.clippingPlanes = this.clipPlanes;
      highlighted.clipShadows = true;
      mesh.material = highlighted;
      this.callbacks.onSelect(mesh.userData.part as PartSpec);
    } else {
      this.callbacks.onSelect(null);
    }
    this.syncGizmo();
  }

  // ---------------------------------------------------------------- Kamera

  setProjection(mode: 'persp' | 'ortho'): void {
    if (mode === 'ortho' && this.camera !== this.ortho) {
      this.syncOrthoFromPersp();
      this.camera = this.ortho;
      (this.controls as unknown as { object: THREE.Camera }).object = this.ortho;
    } else if (mode === 'persp' && this.camera !== this.persp) {
      this.persp.position.copy(this.ortho.position);
      this.persp.quaternion.copy(this.ortho.quaternion);
      this.camera = this.persp;
      (this.controls as unknown as { object: THREE.Camera }).object = this.persp;
    }
    this.controls.update();
  }

  private syncOrthoFromPersp(): void {
    const dist = this.persp.position.distanceTo(this.controls.target);
    const halfH = dist * Math.tan((this.persp.fov * Math.PI) / 360);
    const halfW = halfH * this.persp.aspect;
    this.ortho.left = -halfW;
    this.ortho.right = halfW;
    this.ortho.top = halfH;
    this.ortho.bottom = -halfH;
    this.ortho.zoom = 1;
    this.ortho.position.copy(this.persp.position);
    this.ortho.quaternion.copy(this.persp.quaternion);
    this.ortho.updateProjectionMatrix();
  }

  /** Kamera weich auf eine Blickrichtung ausrichten (ViewCube, Presets) */
  snapToDirection(dir: THREE.Vector3): void {
    const d = dir.clone().normalize();
    // Senkrecht von oben/unten: minimal kippen, damit OrbitControls stabil bleibt
    if (Math.abs(d.y) > 0.999) {
      d.z = 0.001 * Math.sign(d.y || 1);
      d.normalize();
    }
    const dist = (this.camera as THREE.PerspectiveCamera).position.distanceTo(
      this.controls.target,
    );
    const to = this.controls.target.clone().add(d.multiplyScalar(dist));
    this.cameraTween = {
      from: (this.camera as THREE.PerspectiveCamera).position.clone(),
      to,
      t: 0,
    };
  }

  setView(preset: ViewPreset): void {
    const size = this.bounds.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 400);
    const dirs: Record<ViewPreset, THREE.Vector3> = {
      iso: new THREE.Vector3(0.72, 0.5, 0.78),
      front: new THREE.Vector3(0, 0, 1),
      side: new THREE.Vector3(1, 0, 0.001),
      top: new THREE.Vector3(0.001, 1, 0.001),
    };
    // Beim Preset auch den Abstand normieren
    const dist = maxDim * 2.1;
    const pos = this.controls.target
      .clone()
      .add(dirs[preset].clone().normalize().multiplyScalar(dist));
    this.cameraTween = {
      from: (this.camera as THREE.PerspectiveCamera).position.clone(),
      to: pos,
      t: 0,
    };
  }

  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  /** Baugruppe als GLB (binäres glTF) exportieren, Masse in Metern. */
  async exportGlb(): Promise<ArrayBuffer> {
    const exporter = new GLTFExporter();
    // Kopie in Ruhelage (ohne Explosion) und mm → m skaliert
    const group = this.partsGroup.clone(true);
    for (const child of group.children) {
      const home = child.userData.home as THREE.Vector3 | undefined;
      if (home) child.position.copy(home);
    }
    group.scale.setScalar(0.001);
    group.updateMatrixWorld(true);
    const result = await exporter.parseAsync(group, { binary: true });
    return result as ArrayBuffer;
  }

  // ------------------------------------------------------------------ Loop

  private handleResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    if (this.camera === this.ortho) this.syncOrthoFromPersp();
    this.renderer.setSize(w, h);
  };

  private tick = (): void => {
    if (this.disposed) return;
    const dt = this.clock.getDelta();

    if (this.animating) {
      this.animTime += dt;
      this.applyOffsets();
    }

    if (this.cameraTween) {
      this.cameraTween.t = Math.min(1, this.cameraTween.t + dt / 0.35);
      const k = easeInOutCubic(this.cameraTween.t);
      (this.camera as THREE.PerspectiveCamera).position.lerpVectors(
        this.cameraTween.from,
        this.cameraTween.to,
        k,
      );
      if (this.cameraTween.t >= 1) this.cameraTween = null;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.viewCube.sync((this.camera as THREE.PerspectiveCamera).quaternion);
    this.updateLabels();
  };

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.handleResize);
    this.disposeParts();
    this.clearDimensions();
    this.clearMeasure();
    this.viewCube.dispose();
    this.renderer.dispose();
  }
}
