// Pause state - pauses the game and shows pause menu

import type { GameState, StateContext } from '../core/GameStateMachine';
import type { RenderService } from '../services/RenderService';
import type { InputService } from '../services/InputService';

export class PauseState implements GameState {
  readonly name = 'pause';
  private context: StateContext | null = null;
  private pauseMenu: HTMLElement | null = null;
  private renderService: RenderService | null = null;
  private inputService: InputService | null = null;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  async enter(context: StateContext): Promise<void> {
    this.context = context;

    // Resolve services
    const container = context.data?.serviceContainer;
    if (!container) throw new Error('ServiceContainer not provided');

    this.renderService = await container.resolve('render') as RenderService;
    this.inputService = await container.resolve('input') as InputService;

    // Disable input during pause
    this.inputService.disable();

    // Create pause menu UI
    this.pauseMenu = this.createPauseMenu();
    document.body.appendChild(this.pauseMenu);

    // Setup ESC key to resume
    this.onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        this.handleResume();
      }
    };
    window.addEventListener('keydown', this.onKeyDown);

    // Setup button handlers
    this.pauseMenu.querySelector('#btn-resume')?.addEventListener('click', () => {
      this.handleResume();
    });

    this.pauseMenu.querySelector('#btn-restart')?.addEventListener('click', () => {
      this.handleRestart();
    });

    this.pauseMenu.querySelector('#btn-quit')?.addEventListener('click', () => {
      this.handleQuit();
    });
  }

  update(dt: number): void {
    // Physics is paused, but we still render the scene
    if (this.renderService) {
      this.renderService.render(dt);
    }
  }

  async exit(): Promise<void> {
    // Remove pause menu
    if (this.pauseMenu) {
      document.body.removeChild(this.pauseMenu);
      this.pauseMenu = null;
    }

    // Remove key listener
    if (this.onKeyDown) {
      window.removeEventListener('keydown', this.onKeyDown);
      this.onKeyDown = null;
    }

    // Re-enable input when resuming to racing
    if (this.inputService && this.context?.data?.resuming) {
      this.inputService.enable();
    }

    this.renderService = null;
    this.inputService = null;
    this.context = null;
  }

  private createPauseMenu(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'pause-overlay';
    overlay.innerHTML = `
      <div class="pause-container">
        <div class="pause-title">PAUSED</div>
        <div class="pause-panel">
          <button class="menu-button primary" id="btn-resume">Resume</button>
          <button class="menu-button" id="btn-restart">Restart Race</button>
          <button class="menu-button" id="btn-quit">Quit to Menu</button>
        </div>
        <div class="pause-hint">Press ESC to resume</div>
      </div>
    `;
    return overlay;
  }

  private handleResume(): void {
    if (this.context) {
      // Mark that we're resuming so exit() knows to re-enable input
      if (this.context.data) {
        this.context.data.resuming = true;
      }
      this.context.eventBus.emit('game:state-change', { from: 'pause', to: 'racing' });
    }
  }

  private handleRestart(): void {
    if (this.context) {
      // Transition back to racing with fresh state
      this.context.eventBus.emit('game:state-change', { from: 'pause', to: 'racing' });
    }
  }

  private handleQuit(): void {
    if (this.context) {
      this.context.eventBus.emit('game:state-change', { from: 'pause', to: 'menu' });
    }
  }
}
