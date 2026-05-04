// Adaptive tick rate controller for dynamic frequency adjustment based on network conditions

export interface TickRateConfig {
  minHz: number;
  maxHz: number;
  targetHz: number;
  adjustmentStep: number; // Hz per adjustment
  smoothingFactor: number; // 0-1, higher = smoother transitions
}

export class AdaptiveTickRate {
  private currentHz: number;
  private targetHz: number;
  private config: TickRateConfig;
  private rttHistory: number[] = [];
  private maxRttHistory = 10;
  private lastAdjustmentTime = 0;
  private adjustmentCooldownMs = 2000; // Don't adjust more often than every 2s

  constructor(config?: Partial<TickRateConfig>) {
    this.config = {
      minHz: 20,
      maxHz: 60,
      targetHz: 30,
      adjustmentStep: 5,
      smoothingFactor: 0.3,
      ...config,
    };

    this.currentHz = this.config.targetHz;
    this.targetHz = this.config.targetHz;
  }

  /**
   * Update tick rate based on current RTT
   * @param rttMs Round-trip time in milliseconds
   * @param currentTime Current timestamp (for cooldown)
   */
  updateFromRTT(rttMs: number, currentTime: number = performance.now()): void {
    // Add to history
    this.rttHistory.push(rttMs);
    if (this.rttHistory.length > this.maxRttHistory) {
      this.rttHistory.shift();
    }

    // Check cooldown
    if (currentTime - this.lastAdjustmentTime < this.adjustmentCooldownMs) {
      return;
    }

    // Calculate average RTT
    const avgRtt = this.rttHistory.reduce((a, b) => a + b, 0) / this.rttHistory.length;

    // Determine target Hz based on RTT
    let newTargetHz: number;

    if (avgRtt < 30) {
      // Excellent connection: increase to max
      newTargetHz = this.config.maxHz;
    } else if (avgRtt < 50) {
      // Good connection: high frequency
      newTargetHz = Math.min(50, this.config.maxHz);
    } else if (avgRtt < 100) {
      // Fair connection: standard frequency
      newTargetHz = 30;
    } else if (avgRtt < 150) {
      // Poor connection: reduce frequency
      newTargetHz = 25;
    } else {
      // Very poor connection: minimum frequency
      newTargetHz = this.config.minHz;
    }

    // Clamp to configured range
    newTargetHz = Math.max(this.config.minHz, Math.min(this.config.maxHz, newTargetHz));

    // Only adjust if target changed significantly
    if (Math.abs(newTargetHz - this.targetHz) >= this.config.adjustmentStep) {
      this.targetHz = newTargetHz;
      this.lastAdjustmentTime = currentTime;
    }
  }

  /**
   * Get current tick rate with smooth interpolation
   * Call this every frame to get the current Hz value
   */
  getCurrentHz(): number {
    // Smooth transition towards target
    const diff = this.targetHz - this.currentHz;
    this.currentHz += diff * this.config.smoothingFactor;

    // Snap to target if very close
    if (Math.abs(diff) < 0.5) {
      this.currentHz = this.targetHz;
    }

    return Math.round(this.currentHz);
  }

  /**
   * Get current tick interval in milliseconds
   */
  getTickIntervalMs(): number {
    return 1000 / this.getCurrentHz();
  }

  /**
   * Get target Hz (before smoothing)
   */
  getTargetHz(): number {
    return this.targetHz;
  }

  /**
   * Get average RTT from history
   */
  getAverageRTT(): number {
    if (this.rttHistory.length === 0) return 0;
    return this.rttHistory.reduce((a, b) => a + b, 0) / this.rttHistory.length;
  }

  /**
   * Check if tick rate is stable (current ≈ target)
   */
  isStable(): boolean {
    return Math.abs(this.currentHz - this.targetHz) < 1;
  }

  /**
   * Reset to default state
   */
  reset(): void {
    this.currentHz = this.config.targetHz;
    this.targetHz = this.config.targetHz;
    this.rttHistory = [];
    this.lastAdjustmentTime = 0;
  }

  /**
   * Get current configuration
   */
  getConfig(): TickRateConfig {
    return { ...this.config };
  }
}
