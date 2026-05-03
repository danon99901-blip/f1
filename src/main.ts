// Main entry point with new production-ready architecture

import { GameSession } from './game/GameSession';
import { UIManager } from './ui/UIManager';
import { loadingManager } from './utils/LoadingManager';
import './hud/styles.css';
import './client/menu/menu.css';

const SIGNALING_URL =
  (import.meta as any).env?.VITE_SIGNALING_URL || 'ws://localhost:3001';

// Setup loading UI updates
function setupLoadingUI() {
  const barEl = document.getElementById('loading-bar') as HTMLElement;
  const percentEl = document.getElementById('loading-percent') as HTMLElement;
  const stageEl = document.getElementById('loading-stage') as HTMLElement;

  if (!barEl || !percentEl || !stageEl) {
    console.warn('[Main] Loading UI elements not found');
    return;
  }

  loadingManager.onProgress((progress, stage) => {
    barEl.style.width = `${progress}%`;
    percentEl.textContent = `${progress}%`;

    const stageLabels: Record<string, string> = {
      three: 'Loading 3D Engine',
      rapier: 'Loading Physics',
      postprocessing: 'Loading Effects',
      'game-init': 'Initializing Game',
      states: 'Loading States',
      assets: 'Loading Assets',
      complete: 'Ready',
    };

    stageEl.textContent = stageLabels[stage] || stage;
  });
}

async function main() {
  console.log('[Main] Application starting...');
  console.log('[Main] SIGNALING_URL:', SIGNALING_URL);

  setupLoadingUI();

  // Use #app as game container
  const container = document.getElementById('app') as HTMLElement;
  if (!container) {
    throw new Error('#app element not found');
  }

  // Three.js is already loaded (imported by GameSession)
  loadingManager.completeStage('three');

  // Initialize game session
  loadingManager.updateStage('game-init', 0.3);
  const gameSession = new GameSession();

  loadingManager.updateStage('game-init', 0.6);
  await gameSession.init(container, SIGNALING_URL);

  loadingManager.completeStage('game-init');
  loadingManager.completeStage('rapier'); // Rapier initialized in PhysicsService

  // Initialize UI Manager
  const uiManager = new UIManager(gameSession.getEventBus());

  // Dynamically import and register game states
  loadingManager.updateStage('states', 0.2);

  const [
    { MenuState },
    { LobbyState },
    { CountdownState },
    { RacingState },
    { PauseState },
    { ResultsState },
  ] = await Promise.all([
    import('./states/MenuState'),
    import('./states/LobbyState'),
    import('./states/CountdownState'),
    import('./states/RacingState'),
    import('./states/PauseState'),
    import('./states/ResultsState'),
  ]);

  loadingManager.completeStage('states');

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
  loadingManager.updateStage('assets', 0.5);
  await gameSession.start('menu');

  loadingManager.completeStage('assets');
  loadingManager.completeStage('postprocessing'); // Loaded lazily, mark as complete

  // Small delay to show 100% before hiding
  await new Promise(resolve => setTimeout(resolve, 300));

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
