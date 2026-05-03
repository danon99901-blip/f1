// UI Manager coordinating all UI screens

import type { EventBus } from '../core/EventBus';
import type { GameStateName } from '../core/GameStateMachine';

export interface UIScreen {
  show(): void;
  hide(): void;
  dispose(): void;
}

export class UIManager {
  private screens = new Map<string, UIScreen>();
  private currentScreen: UIScreen | null = null;
  private eventBus: EventBus;
  private stateChangeHandler: ((data: any) => void) | null = null;
  private fatalErrorHandler: ((data: any) => void) | null = null;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.setupEventListeners();
  }

  registerScreen(name: string, screen: UIScreen): void {
    this.screens.set(name, screen);
  }

  showScreen(name: string): void {
    if (this.currentScreen) {
      this.currentScreen.hide();
    }

    const screen = this.screens.get(name);
    if (screen) {
      screen.show();
      this.currentScreen = screen;
    }
  }

  hideCurrentScreen(): void {
    if (this.currentScreen) {
      this.currentScreen.hide();
      this.currentScreen = null;
    }
  }

  private setupEventListeners(): void {
    this.stateChangeHandler = ({ to }) => {
      this.handleStateChange(to as GameStateName);
    };
    this.eventBus.on('game:state-change', this.stateChangeHandler);

    this.fatalErrorHandler = ({ message }) => {
      this.showErrorScreen(message);
    };
    this.eventBus.on('error:fatal', this.fatalErrorHandler);
  }

  private handleStateChange(_state: GameStateName): void {
    // UI screens are managed by states themselves
    // This is just for cross-cutting UI concerns
  }

  private showErrorScreen(message: string): void {
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.95);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: white;
      font-family: monospace;
      z-index: 10000;
    `;

    const title = document.createElement('h1');
    title.textContent = 'Error';
    title.style.cssText = 'color: #e10600; font-size: 48px; margin-bottom: 20px;';
    errorDiv.appendChild(title);

    const msg = document.createElement('p');
    msg.textContent = message;
    msg.style.cssText = 'font-size: 20px; margin-bottom: 40px; text-align: center; max-width: 600px;';
    errorDiv.appendChild(msg);

    const button = document.createElement('button');
    button.textContent = 'Return to Menu';
    button.style.cssText = `
      padding: 15px 30px;
      font-size: 20px;
      background: #e10600;
      color: white;
      border: none;
      cursor: pointer;
      font-family: monospace;
    `;
    button.onclick = () => {
      document.body.removeChild(errorDiv);
      this.eventBus.emit('game:request-state-change', { from: 'error', to: 'menu' });
    };
    errorDiv.appendChild(button);

    document.body.appendChild(errorDiv);
  }

  dispose(): void {
    // Remove event listeners
    if (this.stateChangeHandler) {
      this.eventBus.off('game:state-change', this.stateChangeHandler);
      this.stateChangeHandler = null;
    }
    if (this.fatalErrorHandler) {
      this.eventBus.off('error:fatal', this.fatalErrorHandler);
      this.fatalErrorHandler = null;
    }

    this.screens.forEach((screen) => screen.dispose());
    this.screens.clear();
    this.currentScreen = null;
  }
}
