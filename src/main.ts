// Main entry point with new production-ready architecture

import { GameSession } from './game/GameSession';
import { UIManager } from './ui/UIManager';
import { loadingManager } from './utils/LoadingManager';
import { PerformanceMonitor } from './debug/PerformanceMonitor';
import { PerformanceOverlay } from './debug/PerformanceOverlay';
import './hud/styles.css';
import './client/menu/menu.css';

const SIGNALING_URL =
  (import.meta as any).env?.VITE_SIGNALING_URL || 'ws://localhost:3001';

// Check if debug mode is enabled
function isDebugMode(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('debug') === '1';
}

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

  // Setup performance monitor if debug mode is enabled
  let perfMonitor: PerformanceMonitor | null = null;
  let perfOverlay: PerformanceOverlay | null = null;

  if (isDebugMode()) {
    perfMonitor = new PerformanceMonitor();
    perfOverlay = new PerformanceOverlay();
    perfOverlay.show();

    // Integrate with game loop
    const gameLoop = gameSession.getGameLoop();
    if (gameLoop) {
      gameLoop.setPhysicsTimeCallback((time) => {
        perfMonitor?.recordPhysicsTime(time);
      });
    }

    // Update performance overlay every frame
    const updatePerf = () => {
      if (perfMonitor && perfOverlay) {
        perfMonitor.update();

        // Get network stats if available
        const networkService = gameSession.getNetworkService();
        if (networkService) {
          const netStats = networkService.getNetworkStats();
          if (netStats) {
            perfMonitor.updateNetworkStats(netStats.ping, netStats.jitter);
          }
        }

        perfOverlay.update(perfMonitor.getMetrics());
      }
      requestAnimationFrame(updatePerf);
    };
    updatePerf();

    console.log('[Main] Performance monitor enabled (debug mode)');
  }

  // F3 toggle for performance overlay
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F3') {
      e.preventDefault();

      if (!perfMonitor || !perfOverlay) {
        // Initialize if not already
        perfMonitor = new PerformanceMonitor();
        perfOverlay = new PerformanceOverlay();

        const gameLoop = gameSession.getGameLoop();
        if (gameLoop) {
          gameLoop.setPhysicsTimeCallback((time) => {
            perfMonitor?.recordPhysicsTime(time);
          });
        }

        const updatePerf = () => {
          if (perfMonitor && perfOverlay && perfOverlay.isVisible()) {
            perfMonitor.update();

            const networkService = gameSession.getNetworkService();
            if (networkService) {
              const netStats = networkService.getNetworkStats();
              if (netStats) {
                perfMonitor.updateNetworkStats(netStats.ping, netStats.jitter);
              }
            }

            perfOverlay.update(perfMonitor.getMetrics());
          }
          requestAnimationFrame(updatePerf);
        };
        updatePerf();
      }

      perfOverlay.toggle();
      console.log('[Main] Performance overlay toggled');
    }
  });

  // Expose for debugging
  (window as any).gameSession = gameSession;
  (window as any).uiManager = uiManager;
  (window as any).perfMonitor = perfMonitor;
}

main().catch((err) => {
  console.error('[Main] Fatal error:', err);
  alert(`Fatal error: ${err.message}\nCheck console for details.`);
});
