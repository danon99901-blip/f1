// Main entry point with new production-ready architecture

import { GameSession } from './game/GameSession';
import { UIManager } from './ui/UIManager';
import { MenuState } from './states/MenuState';
import { LobbyState } from './states/LobbyState';
import { CountdownState } from './states/CountdownState';
import { RacingState } from './states/RacingState';
import { PauseState } from './states/PauseState';
import { ResultsState } from './states/ResultsState';
import './hud/styles.css';
import './client/menu/menu.css';

const SIGNALING_URL =
  (import.meta as any).env?.VITE_SIGNALING_URL || 'ws://localhost:3001';

async function main() {
  console.log('[Main] Application starting...');
  console.log('[Main] SIGNALING_URL:', SIGNALING_URL);

  // Use #app as game container
  const container = document.getElementById('app') as HTMLElement;
  if (!container) {
    throw new Error('#app element not found');
  }

  // Initialize game session
  const gameSession = new GameSession();
  await gameSession.init(container, SIGNALING_URL);

  // Initialize UI Manager
  const uiManager = new UIManager(gameSession.getEventBus());

  // Register all game states
  const states = new Map<string, any>([
    ['menu', new MenuState()],
    ['lobby', new LobbyState()],
    ['countdown', new CountdownState()],
    ['racing', new RacingState()],
    ['pause', new PauseState()],
    ['results', new ResultsState()],
  ]);

  gameSession.registerStates(states);

  // Start game in menu state
  await gameSession.start('menu');

  // Hide loading screen
  const loadingEl = document.getElementById('loading');
  if (loadingEl) {
    loadingEl.classList.add('hidden');
  }

  console.log('[Main] Game started successfully!');

  // Expose for debugging
  (window as any).gameSession = gameSession;
  (window as any).uiManager = uiManager;
}

main().catch((err) => {
  console.error('[Main] Fatal error:', err);
  alert(`Fatal error: ${err.message}\nCheck console for details.`);
});
