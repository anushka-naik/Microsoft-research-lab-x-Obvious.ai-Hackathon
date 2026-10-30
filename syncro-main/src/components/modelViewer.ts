// Imperative three.js scene controller. This module is only reached through a
// dynamic import from ModelPanel, keeping three.js (and every GLB loader
// dependency) out of the main bundle.
// Type-only namespace import: erased at runtime, so the dynamic import below
// stays the only thing that pulls three.js into the bundle.
import type * as THREE from 'three';
import type { ModelTransform } from '../utils/modelTransform';

export interface ViewerHandle {
  loadGlbUrl(url: string): Promise<void>;
  loadDemoMesh(): void;
  setTransform(t: ModelTransform): void;
  setLightIntensity(v: number): void;
  hasModel(): boolean;
  dispose(): void;
}

export async function createViewer(container: HTMLElement): Promise<ViewerHandle> {
  const THREE = await import('three');
  const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');

  const width = container.clientWidth || 640;
  const height = container.clientHeight || 400;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111827);

  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 200);
  camera.position.set(2.6, 1.8, 3.4);

  const ambient = new THREE.AmbientLight(0xffffff, 1.1);
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 2);
  scene.add(ambient, key);

  const grid = new THREE.GridHelper(10, 20, 0x374151, 0x1f2937);
  scene.add(grid);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0.8, 0);

  const loader = new GLTFLoader();

  let model: THREE.Object3D | null = null;
  let transform: ModelTransform = {
    position: [0, 0, 0],
    rotationDeg: [0, 0, 0],
    scale: 1,
  };

  const DEG = Math.PI / 180;
  const applyTransform = () => {
    if (!model) return;
    model.position.set(
      transform.position[0],
      transform.position[1],
      transform.position[2]
    );
    model.rotation.set(
      transform.rotationDeg[0] * DEG,
      transform.rotationDeg[1] * DEG,
      transform.rotationDeg[2] * DEG
    );
    model.scale.set(transform.scale, transform.scale, transform.scale);
  };

  const disposeObject = (obj: THREE.Object3D) => {
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
  };

  const clearModel = () => {
    if (!model) return;
    scene.remove(model);
    disposeObject(model);
    model = null;
  };

  // Center the asset on its bounding box, normalize it to a predictable size,
  // and rest it on the grid. Normalization is baked into the child; the user
  // transform applies to the wrapper so the two never fight.
  const adopt = (obj: THREE.Object3D, fitSize = 2) => {
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const k = fitSize / maxDim;
    obj.position.sub(center);
    obj.scale.multiplyScalar(k);
    obj.position.y += (size.y * k) / 2;
    const wrapper = new THREE.Group();
    wrapper.add(obj);
    clearModel();
    model = wrapper;
    scene.add(wrapper);
    applyTransform();
  };

  const loadGlbUrl = async (url: string): Promise<void> => {
    const gltf = await loader.loadAsync(url);
    adopt(gltf.scene);
  };

  const loadDemoMesh = () => {
    const geo = new THREE.TorusKnotGeometry(0.55, 0.2, 160, 24);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x8b5cf6,
      metalness: 0.35,
      roughness: 0.3,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.9;
    const wrapper = new THREE.Group();
    wrapper.add(mesh);
    clearModel();
    model = wrapper;
    scene.add(wrapper);
    applyTransform();
  };

  const ro = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  ro.observe(container);

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    loadGlbUrl,
    loadDemoMesh,
    setTransform(t: ModelTransform) {
      transform = t;
      applyTransform();
    },
    setLightIntensity(v: number) {
      key.intensity = v;
    },
    hasModel: () => model !== null,
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      controls.dispose();
      clearModel();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
