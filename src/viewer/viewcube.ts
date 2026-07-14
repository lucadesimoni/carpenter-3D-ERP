// ViewCube (Autodesk-Stil): kleiner Orientierungswürfel oben rechts.
// Zeigt die aktuelle Kameraorientierung; Klick auf eine Fläche richtet
// die Kamera auf die entsprechende Normrichtung aus.

import * as THREE from 'three';

const FACE_LABELS: [string, string][] = [
  ['RECHTS', '+x'],
  ['LINKS', '-x'],
  ['OBEN', '+y'],
  ['UNTEN', '-y'],
  ['VORNE', '+z'],
  ['HINTEN', '-z'],
];

function faceTexture(label: string): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f4f6f7';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#b9c1c6';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, size - 4, size - 4);
  ctx.fillStyle = '#4a5258';
  ctx.font = `600 ${label.length > 5 ? 21 : 24}px 'Segoe UI', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, size / 2, size / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class ViewCube {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private cube: THREE.Mesh;
  private raycaster = new THREE.Raycaster();

  constructor(container: HTMLElement, onPick: (dir: THREE.Vector3) => void) {
    const size = container.clientWidth || 96;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(size, size);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.OrthographicCamera(-1.1, 1.1, 1.1, -1.1, 0.1, 10);
    this.camera.position.set(0, 0, 3);

    const materials = FACE_LABELS.map(
      ([label]) => new THREE.MeshBasicMaterial({ map: faceTexture(label) }),
    );
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.35, 1.35), materials);
    this.scene.add(this.cube);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(this.cube.geometry as THREE.BoxGeometry),
      new THREE.LineBasicMaterial({ color: 0x8f9aa1 }),
    );
    this.cube.add(edges);

    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this.raycaster.setFromCamera(ndc, this.camera);
      const hit = this.raycaster.intersectObject(this.cube, false)[0];
      if (!hit?.face) return;
      // Objektraum-Normale = gewünschte Blickrichtung im Modell-Weltraum
      onPick(hit.face.normal.clone());
    });
  }

  /** Würfel spiegelbildlich zur Hauptkamera drehen */
  sync(cameraQuaternion: THREE.Quaternion): void {
    this.cube.quaternion.copy(cameraQuaternion).invert();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    (this.cube.material as THREE.Material[]).forEach((m) => m.dispose());
    this.cube.geometry.dispose();
    this.renderer.dispose();
  }
}
