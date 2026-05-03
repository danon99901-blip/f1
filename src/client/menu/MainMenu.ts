// Main menu UI component

export interface MainMenuCallbacks {
  onSinglePlayer: () => void;
  onMultiplayerCreate: (playerName: string) => void;
  onMultiplayerJoin: (roomId: string, playerName: string) => void;
}

export class MainMenu {
  private root: HTMLElement;
  private callbacks: MainMenuCallbacks;

  constructor(callbacks: MainMenuCallbacks) {
    this.callbacks = callbacks;
    this.root = this.createDOM();
  }

  private createDOM(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'menu-overlay';
    overlay.innerHTML = `
      <div class="menu-container">
        <div class="menu-title">F1 RACING</div>
        <div class="menu-panel" id="menu-content"></div>
      </div>
    `;
    return overlay;
  }

  private renderMain(): void {
    const content = this.root.querySelector('#menu-content');
    if (!content) return;

    content.innerHTML = `
      <button class="menu-button" id="btn-single">Single Player</button>
      <button class="menu-button" id="btn-multi">Multiplayer</button>
    `;

    content.querySelector('#btn-single')?.addEventListener('click', () => {
      this.callbacks.onSinglePlayer();
    });

    content.querySelector('#btn-multi')?.addEventListener('click', () => {
      this.renderMultiplayerChoice();
    });
  }

  private renderMultiplayerChoice(): void {
    const content = this.root.querySelector('#menu-content');
    if (!content) return;

    content.innerHTML = `
      <div class="menu-section">
        <button class="menu-button" id="btn-create">Create Lobby</button>
        <button class="menu-button" id="btn-join">Join Lobby</button>
      </div>
      <button class="menu-button" id="btn-back">Back</button>
    `;

    content.querySelector('#btn-create')?.addEventListener('click', () => {
      this.renderCreateLobby();
    });

    content.querySelector('#btn-join')?.addEventListener('click', () => {
      this.renderJoinLobby();
    });

    content.querySelector('#btn-back')?.addEventListener('click', () => {
      this.renderMain();
    });
  }

  private renderCreateLobby(): void {
    const content = this.root.querySelector('#menu-content');
    if (!content) return;

    content.innerHTML = `
      <div class="menu-section">
        <label class="menu-label">Your Name</label>
        <input
          type="text"
          class="menu-input"
          id="input-name"
          placeholder="Enter your name"
          maxlength="20"
          autocomplete="off"
        />
      </div>
      <div id="error-message"></div>
      <div class="menu-button-row">
        <button class="menu-button" id="btn-back">Back</button>
        <button class="menu-button primary" id="btn-create">Create</button>
      </div>
    `;

    const nameInput = content.querySelector('#input-name') as HTMLInputElement;
    const errorDiv = content.querySelector('#error-message') as HTMLElement;

    nameInput?.focus();

    const handleCreate = () => {
      const name = nameInput?.value.trim();
      console.log('[MainMenu] Create button clicked, name:', name);
      if (!name) {
        this.displayError(errorDiv, 'Please enter your name');
        return;
      }
      if (name.length < 2) {
        this.displayError(errorDiv, 'Name must be at least 2 characters');
        return;
      }
      console.log('[MainMenu] Calling onMultiplayerCreate callback');
      this.callbacks.onMultiplayerCreate(name);
    };

    nameInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleCreate();
    });

    content.querySelector('#btn-create')?.addEventListener('click', handleCreate);

    content.querySelector('#btn-back')?.addEventListener('click', () => {
      this.renderMultiplayerChoice();
    });
  }

  private renderJoinLobby(): void {
    const content = this.root.querySelector('#menu-content');
    if (!content) return;

    content.innerHTML = `
      <div class="menu-section">
        <label class="menu-label">Your Name</label>
        <input
          type="text"
          class="menu-input"
          id="input-name"
          placeholder="Enter your name"
          maxlength="20"
          autocomplete="off"
        />
      </div>
      <div class="menu-section">
        <label class="menu-label">Room Code</label>
        <input
          type="text"
          class="menu-input"
          id="input-room"
          placeholder="Enter 6-character code"
          maxlength="6"
          autocomplete="off"
          style="text-transform: uppercase;"
        />
      </div>
      <div id="error-message"></div>
      <div class="menu-button-row">
        <button class="menu-button" id="btn-back">Back</button>
        <button class="menu-button primary" id="btn-join">Join</button>
      </div>
    `;

    const nameInput = content.querySelector('#input-name') as HTMLInputElement;
    const roomInput = content.querySelector('#input-room') as HTMLInputElement;
    const errorDiv = content.querySelector('#error-message') as HTMLElement;

    nameInput?.focus();

    // Auto-uppercase room code
    roomInput?.addEventListener('input', () => {
      roomInput.value = roomInput.value.toUpperCase();
    });

    const handleJoin = () => {
      const name = nameInput?.value.trim();
      const roomId = roomInput?.value.trim().toUpperCase();

      if (!name) {
        this.displayError(errorDiv, 'Please enter your name');
        return;
      }
      if (name.length < 2) {
        this.displayError(errorDiv, 'Name must be at least 2 characters');
        return;
      }
      if (!roomId) {
        this.displayError(errorDiv, 'Please enter room code');
        return;
      }
      if (roomId.length !== 6) {
        this.displayError(errorDiv, 'Room code must be 6 characters');
        return;
      }

      this.callbacks.onMultiplayerJoin(roomId, name);
    };

    nameInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') roomInput?.focus();
    });

    roomInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleJoin();
    });

    content.querySelector('#btn-join')?.addEventListener('click', handleJoin);

    content.querySelector('#btn-back')?.addEventListener('click', () => {
      this.renderMultiplayerChoice();
    });
  }

  private displayError(errorDiv: HTMLElement, message: string): void {
    errorDiv.innerHTML = `<div class="menu-error">${message}</div>`;
    setTimeout(() => {
      errorDiv.innerHTML = '';
    }, 3000);
  }

  show(): void {
    this.renderMain();
    document.body.appendChild(this.root);
  }

  hide(): void {
    this.root.remove();
  }

  showError(message: string): void {
    const errorDiv = this.root.querySelector('#error-message');
    if (errorDiv) {
      this.displayError(errorDiv as HTMLElement, message);
    }
  }
}
