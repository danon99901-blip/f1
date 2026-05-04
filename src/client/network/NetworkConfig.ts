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
    // Latency budget breakdown (from key-press to seeing remote-confirmed motion):
    //   inputSendInterval (33ms avg) + RTT/2 + tick (16ms) + snapshotInterval (16ms avg)
    //   + RTT/2 + interpolationDelay (50ms) ≈ 115ms + RTT
    //
    // Was: 50/50/100 = 158ms + RTT
    // Now: 33/33/50  = 115ms + RTT  (saves ~43ms of perceived input lag)
    //
    // We can be aggressive on the buffer because for P2P over WebRTC the jitter
    // between same-region peers is usually well under 30ms. If a player has worse
    // network, updateFromPing automatically promotes them to a slower tier with a
    // bigger interpolation buffer.
    this.config = {
      snapshotInterval: 33,      // 30 Hz
      inputSendInterval: 33,     // 30 Hz
      interpolationDelay: 50,    // 50ms buffer
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
    if (avgPing < 50) {
      // Excellent connection: aggressive update frequency, minimal buffer.
      this.config = {
        snapshotInterval: 33,      // 30 Hz
        inputSendInterval: 33,     // 30 Hz
        interpolationDelay: 50,    // 50ms buffer
      };
    } else if (avgPing < 100) {
      // Good connection: still high-rate, slightly larger buffer.
      this.config = {
        snapshotInterval: 50,      // 20 Hz
        inputSendInterval: 50,     // 20 Hz
        interpolationDelay: 100,   // 100ms buffer
      };
    } else if (avgPing < 150) {
      // Fair connection: lower rate, more cushion.
      this.config = {
        snapshotInterval: 66,      // 15 Hz
        inputSendInterval: 66,     // 15 Hz
        interpolationDelay: 130,   // 130ms buffer
      };
    } else {
      // Poor connection: low frequency, large buffer to ride out jitter.
      this.config = {
        snapshotInterval: 100,     // 10 Hz
        inputSendInterval: 100,    // 10 Hz
        interpolationDelay: 180,   // 180ms buffer
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
      interpolationDelay: 50,
    };
  }
}
