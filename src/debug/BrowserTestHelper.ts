/**
 * Browser Test Helper
 *
 * Utility for manual browser testing of multiplayer functionality.
 * Press 'T' key to toggle test overlay showing detailed diagnostics.
 */

export class BrowserTestHelper {
  private overlay: HTMLDivElement | null = null;
  private isVisible = false;
  private updateInterval: number | null = null;
  private diagnostics: Map<string, any> = new Map();

  constructor() {
    // Only create overlay in browser environment (not in tests)
    if (typeof document !== 'undefined') {
      this.createOverlay();
      this.setupKeyboardListener();
    }
  }

  private createOverlay(): void {
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.85);
      color: #00ff00;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      padding: 15px;
      border-radius: 5px;
      border: 2px solid #00ff00;
      z-index: 10000;
      max-width: 400px;
      max-height: 80vh;
      overflow-y: auto;
      display: none;
      white-space: pre-wrap;
      word-break: break-word;
    `;
    document.body.appendChild(this.overlay);
  }

  private setupKeyboardListener(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (e.key === 't' || e.key === 'T') {
          this.toggle();
        }
      });
    }
  }

  public toggle(): void {
    this.isVisible = !this.isVisible;
    if (this.overlay) {
      this.overlay.style.display = this.isVisible ? 'block' : 'none';
    }

    if (this.isVisible) {
      this.startUpdating();
    } else {
      this.stopUpdating();
    }
  }

  private startUpdating(): void {
    if (this.updateInterval !== null) return;
    if (typeof window === 'undefined') return;

    this.updateInterval = window.setInterval(() => {
      this.render();
    }, 100); // Update 10 times per second
  }

  private stopUpdating(): void {
    if (this.updateInterval !== null) {
      if (typeof window !== 'undefined') {
        clearInterval(this.updateInterval);
      }
      this.updateInterval = null;
    }
  }

  public setDiagnostic(key: string, value: any): void {
    this.diagnostics.set(key, value);
  }

  public removeDiagnostic(key: string): void {
    this.diagnostics.delete(key);
  }

  private render(): void {
    if (!this.overlay || !this.isVisible) return;

    const lines: string[] = [];
    lines.push('=== BROWSER TEST DIAGNOSTICS ===');
    lines.push('Press T to toggle this overlay');
    lines.push('');

    // Sort diagnostics by key for consistent display
    const sortedKeys = Array.from(this.diagnostics.keys()).sort();

    for (const key of sortedKeys) {
      const value = this.diagnostics.get(key);
      if (typeof value === 'object' && value !== null) {
        lines.push(`${key}:`);
        lines.push(JSON.stringify(value, null, 2));
      } else {
        lines.push(`${key}: ${value}`);
      }
    }

    if (sortedKeys.length === 0) {
      lines.push('(No diagnostics data yet)');
    }

    this.overlay.textContent = lines.join('\n');
  }

  public destroy(): void {
    this.stopUpdating();
    if (this.overlay && typeof document !== 'undefined') {
      document.body.removeChild(this.overlay);
      this.overlay = null;
    }
  }

  // Helper methods for common test scenarios
  public logSnapshot(type: 'sent' | 'received', data: any): void {
    const timestamp = new Date().toISOString().split('T')[1]?.slice(0, -1) || '';
    this.setDiagnostic(`last_${type}_snapshot`, {
      time: timestamp,
      tick: data.tick,
      players: data.players?.length || 0
    });
  }

  public logOpponentState(opponentId: string, exists: boolean, position?: any): void {
    this.setDiagnostic(`opponent_${opponentId}`, {
      exists,
      position: position ? `(${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})` : 'N/A'
    });
  }

  public logNetworkState(connected: boolean, role: string, lobbyCode?: string): void {
    this.setDiagnostic('network', {
      connected,
      role,
      lobby: lobbyCode || 'N/A'
    });
  }

  public logPlayerState(position: any, velocity: any, speedKmh: number): void {
    this.setDiagnostic('local_player', {
      position: `(${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`,
      velocity: `(${velocity.x.toFixed(2)}, ${velocity.y.toFixed(2)}, ${velocity.z.toFixed(2)})`,
      speed: `${speedKmh.toFixed(1)} km/h`
    });
  }

  public incrementCounter(key: string): void {
    const current = this.diagnostics.get(key) || 0;
    this.setDiagnostic(key, current + 1);
  }
}

// Global singleton for easy access
let globalTestHelper: BrowserTestHelper | null = null;

export function getBrowserTestHelper(): BrowserTestHelper {
  if (!globalTestHelper) {
    globalTestHelper = new BrowserTestHelper();
  }
  return globalTestHelper;
}

export function destroyBrowserTestHelper(): void {
  if (globalTestHelper) {
    globalTestHelper.destroy();
    globalTestHelper = null;
  }
}
