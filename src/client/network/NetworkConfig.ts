// Adaptive network configuration based on connection quality

export interface NetworkConfig {
  snapshotInterval: number;  // ms between snapshots (host)
  inputSendInterval: number; // ms between input packets (guest)
  interpolationDelay: number; // ms delay for interpolation buffer
}

export class AdaptiveNetworkConfig {
  private config: NetworkConfig;
  private pingHistory: number[] = [];
  private maxPingHistory = 10;

  constructor() {
    // Default config for excellent connection.
    //
    // Critical invariant: interpolationDelay >= 2 * snapshotInterval + expected jitter.
    // Otherwise the interpolator runs out of cushion and falls back to extrapolation
    // (guessing future position by velocity), which causes visible stutter on every
    // packet that arrives even slightly late. For 30Hz snapshots that means buffer
    // >= 67ms + jitter; we use 90ms which absorbs 30ms of jitter — typical for
    // WebRTC P2P between same-region peers.
    //
    // Latency budget (key-press → remote-confirmed motion):
    //   inputSendInterval (33ms avg) + RTT/2 + tick (16ms) + snapshotInterval (16ms avg)
    //   + RTT/2 + interpolationDelay (90ms) ≈ 155ms + RTT
    //
    // Was originally: 50/50/100 = 158ms + RTT
    // Now:            33/33/90  = 155ms + RTT  (3ms savings, but smoother)
    //
    // The 30Hz update rate is the real win — it makes both the local input loop
    // and the remote car's position update twice as responsive to direction changes,
    // which feels more natural than a smaller interpolation buffer would.
    this.config = {
      snapshotInterval: 33,      // 30 Hz
      inputSendInterval: 33,     // 30 Hz
      interpolationDelay: 90,    // ~3 snapshots of buffer
    };
  }

  /**
   * Update configuration based on current ping
   */
  updateFromPing(pingMs: number): void {
    // Add to history
    this.pingHistory.push(pingMs);
    if (this.pingHistory.length > this.maxPingHistory) {
      this.pingHistory.shift();
    }

    // Calculate average ping
    const avgPing = this.pingHistory.reduce((a, b) => a + b, 0) / this.pingHistory.length;

    // Adjust config based on ping ranges. Each tier picks an interpolation buffer
    // wide enough to absorb expected jitter for that ping range, so the rendered
    // car doesn't snap forward when a packet lands a frame late.
    // Each tier holds the invariant interpolationDelay >= 2 * snapshotInterval + jitter.
    if (avgPing < 50) {
      // Excellent connection: high update rate, minimal buffer that's still safe.
      this.config = {
        snapshotInterval: 33,      // 30 Hz
        inputSendInterval: 33,     // 30 Hz
        interpolationDelay: 90,    // ~3 snapshots; absorbs ~25ms jitter
      };
    } else if (avgPing < 100) {
      // Good connection: slightly larger buffer for higher jitter.
      this.config = {
        snapshotInterval: 50,      // 20 Hz
        inputSendInterval: 50,     // 20 Hz
        interpolationDelay: 130,   // ~2.5 snapshots; absorbs ~30ms jitter
      };
    } else if (avgPing < 150) {
      // Fair connection: more cushion.
      this.config = {
        snapshotInterval: 66,      // 15 Hz
        inputSendInterval: 66,     // 15 Hz
        interpolationDelay: 170,   // ~2.5 snapshots; absorbs ~38ms jitter
      };
    } else {
      // Poor connection: low frequency, large buffer to ride out jitter.
      this.config = {
        snapshotInterval: 100,     // 10 Hz
        inputSendInterval: 100,    // 10 Hz
        interpolationDelay: 230,   // ~2.3 snapshots; absorbs ~30ms jitter on top
      };
    }
  }

  getConfig(): NetworkConfig {
    return { ...this.config };
  }

  getSnapshotInterval(): number {
    return this.config.snapshotInterval;
  }

  getInputSendInterval(): number {
    return this.config.inputSendInterval;
  }

  getInterpolationDelay(): number {
    return this.config.interpolationDelay;
  }

  getAveragePing(): number {
    if (this.pingHistory.length === 0) return 0;
    return this.pingHistory.reduce((a, b) => a + b, 0) / this.pingHistory.length;
  }

  reset(): void {
    this.pingHistory = [];
    this.config = {
      snapshotInterval: 33,
      inputSendInterval: 33,
      interpolationDelay: 90,
    };
  }
}
