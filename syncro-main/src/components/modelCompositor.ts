// Offscreen three.js renderer for 2.5D model compositing. Dynamically imported
// (three.js stays in its own lazy chunk) and shared by BOTH the preview overlay
// and the export loop, so they render through one path. Also hosts the
// procedural-GLB mock generator that stands in for an image-to-3D provider in
// keyless QA.
import type * as THREE from 'three';

export interface CompositorHandle {
  readonly canvas: HTMLCanvasElement;
  loadModel(url: string): Promise<void>;
  renderAt(pose: { rotationYDeg: number; scale: number }): void;
  dispose(): void;
}

const SIZE = 512;

export async function createModelCompositor(): Promise<CompositorHandle> {
  const THREE_NS = await import('three');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');

  const renderer = new THREE_NS.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(SIZE, SIZE);
  renderer.setClearAlpha(0);

  const scene = new THREE_NS.Scene();
  // Same camera framing as the editor panel — the preview shows what exports.
  const camera = new THREE_NS.PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(2.6, 1.8, 3.4);
  camera.lookAt(0, 0.8, 0);

  scene.add(new THREE_NS.AmbientLight(0xffffff, 1.1));
  const key = new THREE_NS.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 2);
  scene.add(key);

  const loader = new GLTFLoader();
  let model: THREE.Object3D | null = null;

  const DEG = Math.PI / 180;
  const renderAt = (pose: { rotationYDeg: number; scale: number }) => {
    if (!model) return;
    model.rotation.y = pose.rotationYDeg * DEG;
    model.scale.setScalar(pose.scale);
    renderer.render(scene, camera);
  };

  const clearModel = () => {
    if (!model) return;
    scene.remove(model);
    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    model = null;
  };

  return {
    canvas: renderer.domElement,
    async loadModel(url: string) {
      const gltf = await loader.loadAsync(url);
      const obj = gltf.scene;
      // Center and normalize to a predictable 2-unit size, resting on y=0 —
      // matching the editor panel's framing.
      const box = new THREE_NS.Box3().setFromObject(obj);
      const size = box.getSize(new THREE_NS.Vector3());
      const center = box.getCenter(new THREE_NS.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const k = 2 / maxDim;
      obj.position.sub(center);
      obj.scale.multiplyScalar(k);
      obj.position.y += (size.y * k) / 2;
      const wrapper = new THREE_NS.Group();
      wrapper.add(obj);
      clearModel();
      model = wrapper;
      scene.add(wrapper);
    },
    renderAt,
    dispose() {
      clearModel();
      renderer.dispose();
    },
  };
}

/**
 * Procedural GLB blob for keyless QA — stands in for a real image-to-3D
 * provider result so the whole generate → edit → place → export pipeline can
 * be exercised without any API key.
 */
export async function createDemoGlbUrl(): Promise<string> {
  const THREE_NS = await import('three');
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const mesh = new THREE_NS.Mesh(
    new THREE_NS.TorusKnotGeometry(0.55, 0.2, 96, 16),
    new THREE_NS.MeshStandardMaterial({ color: 0x8b5cf6, metalness: 0.35, roughness: 0.3 })
  );
  mesh.position.y = 0.9;
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    new GLTFExporter().parse(
      mesh,
      (out) => resolve(out as ArrayBuffer),
      (err) => reject(err),
      { binary: true }
    );
  });
  return URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
}
