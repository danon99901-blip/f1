/**
 * Debug overlay for multiplayer verification
 * Shows real-time multiplayer state in the browser
 */

export interface MultiplayerDebugState {
  mode: 'multi_host' | 'multi_guest' | 'single';
  playerId: string;
  roomCode: string;
  snapshotsReceived: number;
  snapshotsProcessed: number;
  opponentsVisible: Array<{ id: string; name: string; visible: boolean }>;
  lastSnapshotTime: number;
}

export class MultiplayerDebugOverlay {
  private container: HTMLDivElement;
  private state: MultiplayerDebugState | null = null;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'multiplayer-debug-overlay';
    this.container.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: #00ff00;
      font-family: monospace;
      font-size: 12px;
      padding: 10px;
      border-radius: 5px;
      z-index: 10000;
      min-width: 300px;
      pointer-events: none;
    `;
    document.body.appendChild(this.container);
  }

  update(state: MultiplayerDebugState): void {
    this.state = state;
    this.render();
  }

  private render(): void {
    if (!this.state) {
      this.container.innerHTML = '<div style="color: #ff0000;">No multiplayer state</div>';
      return;
    }

    const timeSinceSnapshot = this.state.lastSnapshotTime > 0
      ? Math.floor(performance.now() - this.state.lastSnapshotTime)
      : -1;

    const opponentsHtml = this.state.opponentsVisible.length > 0
      ? this.state.opponentsVisible.map(opp => {
          const color = opp.visible ? '#00ff00' : '#ff0000';
          const status = opp.visible ? '✓' : '✗';
          return `<div style="color: ${color}; margin-left: 10px;">${status} ${opp.name} (${opp.id.slice(0, 8)})</div>`;
        }).join('')
      : '<div style="color: #ffaa00; margin-left: 10px;">No opponents</div>';

    this.container.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 5px;">🏎️ MULTIPLAYER DEBUG</div>
      <div>Mode: <span style="color: #00aaff;">${this.state.mode}</span></div>
      <div>Player ID: <span style="color: #00aaff;">${this.state.playerId.slice(0, 8)}</span></div>
      <div>Room: <span style="color: #00aaff;">${this.state.roomCode}</span></div>
      <div style="margin-top: 5px;">Snapshots Received: <span style="color: #ffff00;">${this.state.snapshotsReceived}</span></div>
      <div>Snapshots Processed: <span style="color: #ffff00;">${this.state.snapshotsProcessed}</span></div>
      <div>Last Snapshot: <span style="color: ${timeSinceSnapshot < 0 ? '#ff0000' : timeSinceSnapshot < 1000 ? '#00ff00' : '#ffaa00'};">${timeSinceSnapshot < 0 ? 'Never' : timeSinceSnapshot + 'ms ago'}</span></div>
      <div style="margin-top: 5px; font-weight: bold;">Opponents:</div>
      ${opponentsHtml}
    `;
  }

  destroy(): void {
    if (this.container.parentElement) {
      document.body.removeChild(this.container);
    }
  }
}
