// Menu state - main menu screen

import type { GameState, StateContext } from '../core/GameStateMachine';
import { MainMenu } from '../client/menu/MainMenu';

export class MenuState implements GameState {
  readonly name = 'menu';
  private mainMenu: MainMenu | null = null;

  async enter(context: StateContext): Promise<void> {

    this.mainMenu = new MainMenu({
      onSinglePlayer: () => {
        context.eventBus.emit('game:state-change', { from: 'menu', to: 'racing' });
      },
      onMultiplayerCreate: (_playerName: string) => {
        context.eventBus.emit('game:state-change', { from: 'menu', to: 'lobby' });
      },
      onMultiplayerJoin: (_roomId: string, _playerName: string) => {
        context.eventBus.emit('game:state-change', { from: 'menu', to: 'lobby' });
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
