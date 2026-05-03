// Player name tag that floats above car

import * as THREE from 'three';

export class PlayerNameTag {
  private sprite: THREE.Sprite;
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private playerName: string;

  constructor(playerName: string, color: string = '#ffffff') {
    this.playerName = playerName;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256;
    this.canvas.height = 64;
    this.context = this.canvas.getContext('2d')!;

    this.drawText(color);

    const texture = new THREE.CanvasTexture(this.canvas);
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    this.sprite = new THREE.Sprite(material);
    this.sprite.scale.set(2, 0.5, 1);
    this.sprite.renderOrder = 999; // Always render on top
  }

  private drawText(color: string): void {
    const ctx = this.context;

    // Clear canvas
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Text
    ctx.font = 'bold 32px "JetBrains Mono", monospace';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.playerName, this.canvas.width / 2, this.canvas.height / 2);

    // Update texture
    if (this.sprite.material.map) {
      this.sprite.material.map.needsUpdate = true;
    }
  }

  updatePosition(carPosition: THREE.Vector3): void {
    this.sprite.position.copy(carPosition);
    this.sprite.position.y += 1.5; // Float above car
  }

  addToScene(scene: THREE.Scene): void {
    scene.add(this.sprite);
  }

  removeFromScene(scene: THREE.Scene): void {
    scene.remove(this.sprite);
  }

  dispose(): void {
    this.sprite.material.map?.dispose();
    this.sprite.material.dispose();
  }
}
