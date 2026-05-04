// Network diagnostics tool for debugging multiplayer issues

export class NetworkDiagnostics {
  private static instance: NetworkDiagnostics | null = null;
  private logs: Array<{ timestamp: number; message: string; data?: any }> = [];
  private maxLogs = 100;

  static getInstance(): NetworkDiagnostics {
    if (!NetworkDiagnostics.instance) {
      NetworkDiagnostics.instance = new NetworkDiagnostics();
    }
    return NetworkDiagnostics.instance;
  }

  log(message: string, data?: any): void {
    const entry = {
      timestamp: performance.now(),
      message,
      data,
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    console.log(`[NetDiag] ${message}`, data || '');
  }

  getLogs(): Array<{ timestamp: number; message: string; data?: any }> {
    return [...this.logs];
  }

  clear(): void {
    this.logs = [];
  }

  printSummary(): void {
    console.log('=== Network Diagnostics Summary ===');
    console.log(`Total logs: ${this.logs.length}`);

    const snapshotsSent = this.logs.filter(l => l.message.includes('Host sending snapshot')).length;
    const snapshotsReceived = this.logs.filter(l => l.message.includes('Guest received snapshot')).length;
    const snapshotsProcessed = this.logs.filter(l => l.message.includes('Processing snapshot')).length;
    const opponentsCreated = this.logs.filter(l => l.message.includes('Creating opponent mesh')).length;
    const opponentsUpdated = this.logs.filter(l => l.message.includes('Updating remote player')).length;

    console.log(`Snapshots sent: ${snapshotsSent}`);
    console.log(`Snapshots received: ${snapshotsReceived}`);
    console.log(`Snapshots processed: ${snapshotsProcessed}`);
    console.log(`Opponents created: ${opponentsCreated}`);
    console.log(`Opponents updated: ${opponentsUpdated}`);

    console.log('\nRecent logs:');
    this.logs.slice(-10).forEach(log => {
      console.log(`  [${log.timestamp.toFixed(0)}] ${log.message}`, log.data || '');
    });
  }
}
