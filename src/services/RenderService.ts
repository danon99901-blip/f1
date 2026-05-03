// Render service wrapping Three.js scene, camera, and composer

import * as THREE from 'three';
import { createScene } from '../scene';
import { loadComposer } from '../effects/composerLoader';
import type { ComposerBundle } from '../effects/composer';
import type { Service } from '../core/ServiceContainer';

export class RenderService implements Service {
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private composer: ComposerBundle | null = null;
  private container: HTMLElement | null = null;
  private resizeHandler: (() => void) | null = null;

  initWithContainer(container: HTMLElement): void {
    this.container = container;

    const sceneData = createScene(container);
    this.scene = sceneData.scene;
    this.camera = sceneData.camera;
    this.renderer = sceneData.renderer;

    // Debug canvas
    console.log('[RenderService] Canvas info:', {
      width: this.renderer.domElement.width,
      height: this.renderer.domElement.height,
      style: this.renderer.domElement.style.cssText,
      parent: this.renderer.domElement.parentElement?.tagName,
      rect: this.renderer.domElement.getBoundingClientRect(),
      zIndex: window.getComputedStyle(this.renderer.domElement).zIndex,
    });

    // Lazy load composer (non-blocking)
    void loadComposer(this.renderer, this.scene, this.camera)
      .then((composer) => {
        this.composer = composer;
        console.log('[RenderService] Post-processing loaded');
      })
      .catch((err) => {
        console.error('[RenderService] Failed to load composer:', err);
      });

    // Handle window resize
    this.resizeHandler = () => this.handleResize();
    window.addEventListener('resize', this.resizeHandler);
  }

  private renderCount = 0;

  render(dt: number): void {
    if (!this.renderer || !this.scene || !this.camera) {
      throw new Error('RenderService not initialized');
    }

    // Log first few renders to verify it's working
    if (this.renderCount < 5) {
      console.log(`[RenderService] Render #${this.renderCount}, dt:`, dt);
      console.log(`[RenderService] Scene children:`, this.scene.children.length);
      console.log(`[RenderService] Camera position:`, this.camera.position);
      this.renderCount++;
    }

    // Direct rendering without composer (temporary fix)
    if (this.composer) {
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
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

    // Dispose composer before nullifying
    if (this.composer && typeof this.composer.dispose === 'function') {
      this.composer.dispose();
    }
    this.composer = null;

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }

    this.scene = null;
    this.camera = null;
    this.container = null;
  }
}
