// Menu state - main menu screen

import type { GameState, StateContext } from '../core/GameStateMachine';
import { MainMenu } from '../client/menu/MainMenu';

export class MenuState implements GameState {
  readonly name = 'menu';
  private mainMenu: MainMenu | null = null;

  async enter(context: StateContext): Promise<void> {

    this.mainMenu = new MainMenu({
      onSinglePlayer: () => {
        console.log('[MenuState] Single player clicked');
        context.eventBus.emit('game:request-state-change', { from: 'menu', to: 'racing' });
      },
      onMultiplayerCreate: (playerName: string) => {
        console.log('[MenuState] Multiplayer create clicked, player:', playerName);
        context.eventBus.emit('game:request-state-change', {
          from: 'menu',
          to: 'lobby',
          data: { playerName, serviceContainer: context.data?.serviceContainer }
        });
      },
      onMultiplayerJoin: (roomId: string, playerName: string) => {
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
    if (this.mainMenu) {
      this.mainMenu.hide();
      this.mainMenu = null;
    }
  }
}
