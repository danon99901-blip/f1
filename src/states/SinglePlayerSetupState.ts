// Single player setup state - track and lap selection

import type { GameState, StateContext } from '../core/GameStateMachine';
import { SinglePlayerSetupMenu } from '../client/menu/SinglePlayerSetupMenu';

export class SinglePlayerSetupState implements GameState {
  readonly name = 'single-player-setup';
  private setupMenu: SinglePlayerSetupMenu | null = null;

  async enter(context: StateContext): Promise<void> {

    this.setupMenu = new SinglePlayerSetupMenu({
      onStartRace: (trackType: string, totalLaps: number) => {
        console.log('[SinglePlayerSetupState] Starting race:', trackType, totalLaps);
        context.eventBus.emit('game:request-state-change', {
          from: 'single-player-setup',
          to: 'countdown',
          data: {
            gameMode: 'single',
            trackType,
            totalLaps,
            serviceContainer: context.data?.serviceContainer,
          },
        });
      },
      onBack: () => {
        console.log('[SinglePlayerSetupState] Back to menu');
        context.eventBus.emit('game:request-state-change', {
          from: 'single-player-setup',
          to: 'menu',
        });
      },
    });

    this.setupMenu.show();
  }

  update(_dt: number): void {
    // Setup menu is static, no updates needed
  }

  async exit(): Promise<void> {
    if (this.setupMenu) {
      this.setupMenu.hide();
      this.setupMenu = null;
    }
  }
}
