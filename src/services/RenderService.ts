// Render service wrapping Three.js scene, camera, and composer

import * as THREE from 'three';
import { createScene } from '../scene';
import { createComposer } from '../effects/composer';
import type { Service } from '../core/ServiceContainer';

export class RenderService implements Service {
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private composer: ReturnType<typeof createComposer> | null = null;
  private container: HTMLElement | null = null;
  private resizeHandler: (() => void) | null = null;

  initWithContainer(container: HTMLElement): void {
    this.container = container;

    const sceneData = createScene(container);
    this.scene = sceneData.scene;
    this.camera = sceneData.camera;
    this.renderer = sceneData.renderer;
    this.composer = createComposer(this.renderer, this.scene, this.camera);

    // Handle window resize
    this.resizeHandler = () => this.handleResize();
    window.addEventListener('resize', this.resizeHandler);
  }

  render(dt: number): void {
    if (!this.composer) {
      throw new Error('RenderService not initialized');
    }
    this.composer.render(dt);
  }

  setSpeed(speedKmh: number): void {
    if (this.composer) {
      this.composer.setSpeed(speedKmh);
    }
  }

  addMesh(mesh: THREE.Object3D): void {
    if (!this.scene) {
      throw new Error('RenderService not initialized');
    }
    this.scene.add(mesh);
  }

  removeMesh(mesh: THREE.Object3D): void {
    if (!this.scene) {
      throw new Error('RenderService not initialized');
    }
    this.scene.remove(mesh);
  }

  getScene(): THREE.Scene {
    if (!this.scene) {
      throw new Error('RenderService not initialized');
    }
    return this.scene;
  }

  getCamera(): THREE.PerspectiveCamera {
    if (!this.camera) {
      throw new Error('RenderService not initialized');
    }
    return this.camera;
  }

  setCameraPosition(position: THREE.Vector3): void {
    if (this.camera) {
      this.camera.position.copy(position);
    }
  }

  setCameraLookAt(target: THREE.Vector3): void {
    if (this.camera) {
      this.camera.lookAt(target);
    }
  }

  private handleResize(): void {
    if (!this.camera || !this.renderer || !this.container) return;

    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  dispose(): void {
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }

    this.scene = null;
    this.camera = null;
    this.composer = null;
    this.container = null;
  }
}
