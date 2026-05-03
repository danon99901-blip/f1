// Menu manager - orchestrates menu flow and game transitions

import { MainMenu } from './MainMenu';
import { LobbyMenu } from './LobbyMenu';
import type { RoomInfo } from '../../shared/types';
import './menu.css';

type MenuState = 'main' | 'lobby' | 'game';

export interface MenuManagerCallbacks {
  onSinglePlayer: () => void;
  onMultiplayerHost: (playerName: string, totalLaps: number) => void;
  onMultiplayerJoin: (roomId: string, playerName: string) => void;
  onStartRace: () => void;
  onLeaveLobby: () => void;
}

export class MenuManager {
  private state: MenuState = 'main';
  private mainMenu: MainMenu | null = null;
  private lobbyMenu: LobbyMenu | null = null;
  private callbacks: MenuManagerCallbacks;
  private pendingLaps: number = 3;

  constructor(callbacks: MenuManagerCallbacks) {
    this.callbacks = callbacks;
  }

  showMainMenu(): void {
    this.hideAll();
    this.state = 'main';

    this.mainMenu = new MainMenu({
      onSinglePlayer: () => {
        this.hideAll();
        this.state = 'game';
        this.callbacks.onSinglePlayer();
      },
      onMultiplayerCreate: (playerName: string) => {
        this.callbacks.onMultiplayerHost(playerName, this.pendingLaps);
      },
      onMultiplayerJoin: (roomId: string, playerName: string) => {
        this.callbacks.onMultiplayerJoin(roomId, playerName);
      },
    });

    this.mainMenu.show();
  }

  showLobby(roomInfo: RoomInfo, isHost: boolean, localPlayerId: string): void {
    this.hideAll();
    this.state = 'lobby';

    this.lobbyMenu = new LobbyMenu(roomInfo, isHost, {
      onStartRace: () => {
        this.callbacks.onStartRace();
      },
      onLeaveLobby: () => {
        this.callbacks.onLeaveLobby();
        this.showMainMenu();
      },
      onChangeLaps: (laps: number) => {
        this.pendingLaps = laps;
        // Update room info with new lap count
        const updatedRoomInfo = { ...roomInfo, totalLaps: laps };
        this.lobbyMenu?.updateRoomInfo(updatedRoomInfo);
      },
      onColorChange: (_color: number) => {
        // Color changes are handled by LobbyState
      },
    }, localPlayerId);

    this.lobbyMenu.show();
  }

  updateLobby(roomInfo: RoomInfo): void {
    if (this.state === 'lobby' && this.lobbyMenu) {
      this.lobbyMenu.updateRoomInfo(roomInfo);
    }
  }

  startGame(): void {
    this.hideAll();
    this.state = 'game';
  }

  showError(message: string): void {
    if (this.mainMenu) {
      this.mainMenu.showError(message);
    }
  }

  private hideAll(): void {
    this.mainMenu?.hide();
    this.mainMenu = null;
    this.lobbyMenu?.hide();
    this.lobbyMenu = null;
  }

  getCurrentState(): MenuState {
    return this.state;
  }
}
