// Unified game loop abstraction

export type GameLoopCallback = (dt: number) => void;

export class GameLoop {
  private running = false;
  private paused = false;
  private lastTime = 0;
  private animationFrameId: number | null = null;
  private callback: GameLoopCallback;
  private timeScale = 1.0;

  constructor(callback: GameLoopCallback) {
    this.callback = callback;
  }

  start(): void {
    if (this.running) {
      console.warn('[GameLoop] Already running');
      return;
    }

    console.log('[GameLoop] Starting...');
    this.running = true;
    this.paused = false;
    this.lastTime = performance.now();
    this.tick();
    console.log('[GameLoop] Started successfully');
  }

  stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.lastTime = performance.now();
  }

  setTimeScale(scale: number): void {
    this.timeScale = Math.max(0, scale);
  }

  isPaused(): boolean {
    return this.paused;
  }

  isRunning(): boolean {
    return this.running;
  }

  private tick = (): void => {
    if (!this.running) return;

    const currentTime = performance.now();
    const rawDt = (currentTime - this.lastTime) / 1000;
    this.lastTime = currentTime;

    // Cap delta time to prevent spiral of death
    const dt = Math.min(rawDt, 1 / 30) * this.timeScale;

    if (!this.paused && dt > 0) {
      try {
        this.callback(dt);
      } catch (error) {
        console.error('[GameLoop] Error in callback:', error);
      }
    }

    this.animationFrameId = requestAnimationFrame(this.tick);
  };
}
