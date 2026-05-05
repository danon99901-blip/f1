// Menu state - main menu screen

import type { GameState, StateContext } from '../core/GameStateMachine';
import { MainMenu } from '../client/menu/MainMenu';

export class MenuState implements GameState {
  readonly name = 'menu';
  private mainMenu: MainMenu | null = null;
  private actionInProgress = false;

  async enter(context: StateContext): Promise<void> {

    this.mainMenu = new MainMenu({
      onSinglePlayer: () => {
        if (this.actionInProgress) return;
        this.actionInProgress = true;

        console.log('[MenuState] Single player clicked');
        context.eventBus.emit('game:request-state-change', {
          from: 'menu',
          to: 'single-player-setup',
          data: { serviceContainer: context.data?.serviceContainer }
        });
      },
      onMultiplayerCreate: (playerName: string) => {
        if (this.actionInProgress) return;
        this.actionInProgress = true;

        console.log('[MenuState] Multiplayer create clicked, player:', playerName);
        context.eventBus.emit('game:request-state-change', {
          from: 'menu',
          to: 'lobby',
          data: { playerName, serviceContainer: context.data?.serviceContainer }
        });
      },
      onMultiplayerJoin: (roomId: string, playerName: string) => {
        if (this.actionInProgress) return;
        this.actionInProgress = true;

        console.log('[MenuState] Multiplayer join clicked, room:', roomId, 'player:', playerName);
        context.eventBus.emit('game:request-state-change', {
          from: 'menu',
          to: 'lobby',
          data: { roomId, playerName, serviceContainer: context.data?.serviceContainer }
        });
      },
    });

    this.mainMenu.show();
  }

  update(_dt: number): void {
    // Menu is static, no updates needed
  }

  async exit(): Promise<void> {
    this.actionInProgress = false;

    if (this.mainMenu) {
      this.mainMenu.hide();
      this.mainMenu = null;
    }
  }
}
