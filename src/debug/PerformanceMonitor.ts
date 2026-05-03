export interface PerformanceMetrics {
  fps: number;
  frameTime: number;
  frameTimeMax: number;
  physicsTime: number;
  physicsTimeMax: number;
  memoryUsed?: number;
  memoryLimit?: number;
  ping?: number;
  jitter?: number;
  packetLoss?: number;
}

export class PerformanceMonitor {
  private metrics: PerformanceMetrics = {
    fps: 0,
    frameTime: 0,
    frameTimeMax: 0,
    physicsTime: 0,
    physicsTimeMax: 0,
  };

  private frameTimeSamples: number[] = [];
  private physicsTimeSamples: number[] = [];
  private lastFrameTime = performance.now();
  private frameCount = 0;
  private fpsUpdateInterval = 500;
  private lastFpsUpdate = performance.now();

  private readonly maxSamples = 60;

  update(): void {
    const now = performance.now();
    const deltaTime = now - this.lastFrameTime;
    this.lastFrameTime = now;

    this.frameTimeSamples.push(deltaTime);
    if (this.frameTimeSamples.length > this.maxSamples) {
      this.frameTimeSamples.shift();
    }

    this.frameCount++;

    if (now - this.lastFpsUpdate >= this.fpsUpdateInterval) {
      const elapsed = now - this.lastFpsUpdate;
      this.metrics.fps = Math.round((this.frameCount * 1000) / elapsed);
      this.metrics.frameTime = this.average(this.frameTimeSamples);
      this.metrics.frameTimeMax = Math.max(...this.frameTimeSamples);

      this.frameCount = 0;
      this.lastFpsUpdate = now;
    }

    // Check for memory API (Chrome-specific)
    const perfWithMemory = performance as any;
    if (perfWithMemory.memory) {
      this.metrics.memoryUsed = perfWithMemory.memory.usedJSHeapSize / 1048576;
      this.metrics.memoryLimit = perfWithMemory.memory.jsHeapSizeLimit / 1048576;
    }
  }

  recordPhysicsTime(time: number): void {
    this.physicsTimeSamples.push(time);
    if (this.physicsTimeSamples.length > this.maxSamples) {
      this.physicsTimeSamples.shift();
    }

    this.metrics.physicsTime = this.average(this.physicsTimeSamples);
    this.metrics.physicsTimeMax = Math.max(...this.physicsTimeSamples);
  }

  updateNetworkStats(ping?: number, jitter?: number, packetLoss?: number): void {
    if (ping !== undefined) this.metrics.ping = ping;
    if (jitter !== undefined) this.metrics.jitter = jitter;
    if (packetLoss !== undefined) this.metrics.packetLoss = packetLoss;
  }

  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  reset(): void {
    this.frameTimeSamples = [];
    this.physicsTimeSamples = [];
    this.metrics = {
      fps: 0,
      frameTime: 0,
      frameTimeMax: 0,
      physicsTime: 0,
      physicsTimeMax: 0,
    };
  }

  private average(samples: number[]): number {
    if (samples.length === 0) return 0;
    return samples.reduce((a, b) => a + b, 0) / samples.length;
  }
}
