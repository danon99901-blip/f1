// Connection status indicator

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

export class ConnectionStatusIndicator {
  private root: HTMLElement;
  private textEl: HTMLElement;
  private currentStatus: ConnectionStatus = 'connecting';

  constructor() {
    this.root = this.createDOM();
    this.textEl = this.root.querySelector('#connection-text')!;
  }

  private createDOM(): HTMLElement {
    const indicator = document.createElement('div');
    indicator.className = 'connection-status connecting';
    indicator.innerHTML = `
      <div class="connection-status-dot"></div>
      <span id="connection-text">Connecting...</span>
    `;
    return indicator;
  }

  show(): void {
    if (!this.root.parentElement) {
      document.body.appendChild(this.root);
    }
    this.root.classList.add('visible');
  }

  hide(): void {
    this.root.classList.remove('visible');
  }

  setStatus(status: ConnectionStatus): void {
    if (this.currentStatus === status) return;

    this.currentStatus = status;
    this.root.className = `connection-status ${status}`;

    switch (status) {
      case 'connected':
        this.textEl.textContent = 'Connected';
        this.root.classList.add('visible');
        // Auto-hide after 2 seconds
        setTimeout(() => this.hide(), 2000);
        break;
      case 'connecting':
        this.textEl.textContent = 'Connecting...';
        this.root.classList.add('visible');
        break;
      case 'disconnected':
        this.textEl.textContent = 'Disconnected';
        this.root.classList.add('visible');
        break;
    }
  }

  remove(): void {
    this.root.remove();
  }
}
