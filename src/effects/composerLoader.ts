import * as THREE from 'three';
import type { ComposerBundle } from './composer';
import { loadingManager } from '../utils/LoadingManager';

/**
 * Lazy loader for post-processing composer.
 * Delays loading the heavy postprocessing library until actually needed.
 */
export async function loadComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera
): Promise<ComposerBundle> {
  loadingManager.updateStage('postprocessing', 0.3);
  const { createComposer } = await import('./composer');

  loadingManager.updateStage('postprocessing', 0.7);
  const bundle = createComposer(renderer, scene, camera);

  loadingManager.completeStage('postprocessing');
  return bundle;
}
