// Main entry point with new production-ready architecture

import { GameSession } from './game/GameSession';
import { UIManager } from './ui/UIManager';
import { MenuState } from './states/MenuState';
import { LobbyState } from './states/LobbyState';
import { CountdownState } from './states/CountdownState';
import { RacingState } from './states/RacingState';
import { PauseState } from './states/PauseState';
import { ResultsState } from './states/ResultsState';
import { RemoteLogger } from './utils/RemoteLogger';
import './hud/styles.css';

const SIGNALING_URL =
  (import.meta as any).env?.VITE_SIGNALING_URL || 'ws://localhost:3001';

async function main() {
  RemoteLogger.log('info', '[Main] Application starting...');
  RemoteLogger.log('info', '[Main] SIGNALING_URL:', SIGNALING_URL);

  const appEl = document.getElementById('app');
  const loadingEl = document.getElementById('loading');

  RemoteLogger.log('info', '[Main] App element:', appEl ? 'found' : 'NOT FOUND');
  RemoteLogger.log('info', '[Main] Loading element:', loadingEl ? 'found' : 'NOT FOUND');

  if (!appEl) {
    RemoteLogger.log('error', '[Main] #app element not found!');
    throw new Error('#app element not found');
  }

  try {
    RemoteLogger.log('info', '[Main] Creating GameSession...');
    // Create game session
    const gameSession = new GameSession();
    const eventBus = gameSession.getEventBus();
    const serviceContainer = gameSession.getServiceContainer();

    RemoteLogger.log('info', '[Main] Initializing game session...');
    // Initialize game session
    loadingEl?.classList.remove('hidden');
    await gameSession.init(appEl, SIGNALING_URL);
    RemoteLogger.log('info', '[Main] Game session initialized!');
    loadingEl?.classList.add('hidden');

    // Create UI manager
    const uiManager = new UIManager(eventBus);

    // Register game states
    const states = new Map();
    states.set('menu', new MenuState());
    states.set('lobby', new LobbyState());
    states.set('countdown', new CountdownState());
    states.set('racing', new RacingState());
    states.set('pause', new PauseState());
    states.set('results', new ResultsState());

    gameSession.registerStates(states);

    // Setup state transition handlers
    eventBus.on('game:state-change', async ({ to, from }) => {
      console.log(`[Main] State transition: ${from} → ${to}`);

      try {
        // Pass service container to states that need it
        const stateData: Record<string, any> = { serviceContainer };

        // Handle specific transitions
        if (to === 'racing') {
          if (from === 'menu') {
            // Single-player mode
            stateData.gameMode = 'single';
            stateData.totalLaps = 10;
          } else if (from === 'countdown') {
            // Multiplayer mode (data already set by lobby)
            stateData.gameMode = serviceContainer.has('network') ? 'multi_host' : 'single';
          }
        }

        await gameSession.transitionTo(to, stateData);
      } catch (error) {
        console.error('[Main] State transition error:', error);
        eventBus.emit('error:fatal', {
          message: `Failed to transition to ${to}`,
          error: error instanceof Error ? error : undefined,
        });
      }
    });

    // Setup network event handlers
    eventBus.on('network:connected', () => {
      console.log('[Main] Network connected');
    });

    eventBus.on('network:disconnected', ({ reason }) => {
      console.warn('[Main] Network disconnected:', reason);
    });

    eventBus.on('network:reconnecting', ({ attempt }) => {
      console.log(`[Main] Reconnecting (attempt ${attempt})...`);
    });

    // Setup race event handlers
    eventBus.on('race:lap-complete', ({ playerId, lapNumber, lapTime }) => {
      console.log(`[Main] Player ${playerId} completed lap ${lapNumber} in ${lapTime}ms`);
    });

    eventBus.on('race:finish', ({ playerId, position, totalTime }) => {
      console.log(`[Main] Player ${playerId} finished in position ${position} (${totalTime}s)`);
    });

    // Expose game session for debugging
    (window as any).__game = {
      session: gameSession,
      eventBus,
      serviceContainer,
      uiManager,
      transitionTo: (state: string) => gameSession.transitionTo(state),
      pause: () => gameSession.pauseGame(),
      resume: () => gameSession.resumeGame(),
    };

    // Start game at menu
    await gameSession.start('menu');

    console.log('[Main] Game initialized successfully');
  } catch (error) {
    console.error('[Main] Initialization error:', error);
    if (loadingEl) {
      loadingEl.textContent = 'ERROR — see console';
      loadingEl.classList.remove('hidden');
    }
  }
}

main().catch((err) => {
  console.error('[Main] Fatal error:', err);
  const el = document.getElementById('loading');
  if (el) el.textContent = 'ERROR — see console';
});
