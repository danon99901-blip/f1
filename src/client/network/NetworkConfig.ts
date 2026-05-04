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
    // Default config for good connection (< 50ms ping)
    this.config = {
      snapshotInterval: 50,      // 20 Hz
      inputSendInterval: 50,     // 20 Hz
      interpolationDelay: 100,   // 100ms buffer
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

    // Adjust config based on ping ranges
    if (avgPing < 50) {
      // Excellent connection: high frequency updates
      this.config = {
        snapshotInterval: 50,      // 20 Hz
        inputSendInterval: 50,     // 20 Hz
        interpolationDelay: 100,   // 100ms buffer
      };
    } else if (avgPing < 100) {
      // Good connection: standard frequency
      this.config = {
        snapshotInterval: 66,      // 15 Hz
        inputSendInterval: 66,     // 15 Hz
        interpolationDelay: 120,   // 120ms buffer
      };
    } else if (avgPing < 150) {
      // Fair connection: reduced frequency
      this.config = {
        snapshotInterval: 100,     // 10 Hz
        inputSendInterval: 100,    // 10 Hz
        interpolationDelay: 150,   // 150ms buffer
      };
    } else {
      // Poor connection: low frequency, large buffer
      this.config = {
        snapshotInterval: 150,     // ~6.7 Hz
        inputSendInterval: 150,    // ~6.7 Hz
        interpolationDelay: 200,   // 200ms buffer
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
      snapshotInterval: 50,
      inputSendInterval: 50,
      interpolationDelay: 100,
    };
  }
}
