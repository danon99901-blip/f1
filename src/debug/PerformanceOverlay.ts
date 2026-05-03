import type { PerformanceMetrics } from './PerformanceMonitor';

export class PerformanceOverlay {
  private container: HTMLDivElement;
  private visible = false;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'performance-overlay';
    this.container.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: #00ff00;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      padding: 10px;
      border-radius: 4px;
      z-index: 10000;
      pointer-events: none;
      min-width: 200px;
      display: none;
    `;
    document.body.appendChild(this.container);
  }

  show(): void {
    this.visible = true;
    this.container.style.display = 'block';
  }

  hide(): void {
    this.visible = false;
    this.container.style.display = 'none';
  }

  toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  update(metrics: PerformanceMetrics): void {
    if (!this.visible) return;

    const lines: string[] = [
      `<div style="color: #ffff00; font-weight: bold; margin-bottom: 5px;">PERFORMANCE</div>`,
      `FPS: ${this.colorize(metrics.fps, 60, 30)} ${metrics.fps}`,
      `Frame: ${this.colorize(metrics.frameTime, 16.67, 33.33, true)} ${metrics.frameTime.toFixed(2)}ms (max: ${metrics.frameTimeMax.toFixed(2)}ms)`,
      `Physics: ${this.colorize(metrics.physicsTime, 16.67, 33.33, true)} ${metrics.physicsTime.toFixed(2)}ms (max: ${metrics.physicsTimeMax.toFixed(2)}ms)`,
    ];

    if (metrics.memoryUsed !== undefined && metrics.memoryLimit !== undefined) {
      const memPercent = (metrics.memoryUsed / metrics.memoryLimit) * 100;
      lines.push(
        `Memory: ${this.colorize(memPercent, 70, 85, true)} ${metrics.memoryUsed.toFixed(0)}MB / ${metrics.memoryLimit.toFixed(0)}MB (${memPercent.toFixed(1)}%)`
      );
    }

    if (metrics.ping !== undefined) {
      lines.push('');
      lines.push(`<div style="color: #ffff00; font-weight: bold; margin-top: 5px;">NETWORK</div>`);
      lines.push(`Ping: ${this.colorize(metrics.ping, 50, 100, true)} ${metrics.ping.toFixed(0)}ms`);

      if (metrics.jitter !== undefined) {
        lines.push(`Jitter: ${this.colorize(metrics.jitter, 10, 30, true)} ${metrics.jitter.toFixed(1)}ms`);
      }

      if (metrics.packetLoss !== undefined) {
        lines.push(`Packet Loss: ${this.colorize(metrics.packetLoss, 1, 5, true)} ${metrics.packetLoss.toFixed(1)}%`);
      }
    }

    this.container.innerHTML = lines.join('<br>');
  }

  private colorize(value: number, goodThreshold: number, badThreshold: number, inverse = false): string {
    let color: string;

    if (inverse) {
      if (value <= goodThreshold) {
        color = '#00ff00';
      } else if (value <= badThreshold) {
        color = '#ffff00';
      } else {
        color = '#ff0000';
      }
    } else {
      if (value >= goodThreshold) {
        color = '#00ff00';
      } else if (value >= badThreshold) {
        color = '#ffff00';
      } else {
        color = '#ff0000';
      }
    }

    return `<span style="color: ${color}">●</span>`;
  }

  dispose(): void {
    this.container.remove();
  }
}
