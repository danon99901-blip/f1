import * as THREE from 'three';

export interface SceneBundle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** Update camera aspect + renderer size. Caller owns the resize listener. */
  resize(width: number, height: number): void;
}

export function createScene(canvasParent: HTMLElement): SceneBundle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x6ab0ff);
  scene.fog = new THREE.Fog(0x6ab0ff, 80, 300);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 6, 12);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  // pixelRatio: 1 instead of min(devicePixelRatio, 2). On a HiDPI laptop
  // (devicePixelRatio = 2) the previous setting rendered 4× the fragments
  // a 1× canvas would, which on an integrated GPU is the primary fps cost
  // for this game. Verified: disabling postprocessing changed fps by 0,
  // meaning the GPU spends all its time on raw fragment shading. SMAA
  // already handles AA so the visible quality loss from dropping DPR is
  // mostly subpixel sharpness on HUD text — acceptable tradeoff for 60fps.
  // If we ever want to support HiDPI again, gate it behind a "HD mode"
  // graphics setting.
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  // PCFShadowMap (3 samples) instead of PCFSoftShadowMap (5 samples). The
  // soft variant looked nicer on stationary screenshots but the cost added up
  // when racing past dozens of barriers on an integrated GPU. PCF is a fixed
  // 40% cheaper and visually similar at the size of objects we shadow.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  canvasParent.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x404040, 0.7);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  sun.position.set(40, 60, 20);
  sun.castShadow = true;
  // 1024×1024 instead of 2048×2048. Quartering the shadow-map texel count
  // means the sun's depth render does ~4x less work per frame. Visual loss
  // is invisible at typical race-camera distance.
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 200;
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60;
  sun.shadow.camera.bottom = -60;
  scene.add(sun);

  function resize(width: number, height: number): void {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  return { scene, camera, renderer, resize };
}

export function createGround(scene: THREE.Scene): { mesh: THREE.Mesh; grid: THREE.GridHelper } {
  const geo = new THREE.PlaneGeometry(400, 400);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.95, metalness: 0.0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  scene.add(mesh);

  // GridHelper is created but NOT added to the scene. 80×80 = 6400 alpha-blended
  // line segments cost real GPU time and are invisible during racing (the track
  // covers them, plus alpha blending bypasses depth pre-pass). We still return
  // it for backward-compat with callers that expect it; if some debug overlay
  // wants the grid, it can `scene.add(grid)` itself.
  const grid = new THREE.GridHelper(400, 80, 0x444444, 0x303030);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.6;

  return { mesh, grid };
}
