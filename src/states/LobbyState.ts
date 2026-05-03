// Lobby state - multiplayer lobby

import type { GameState, StateContext } from '../core/GameStateMachine';
import { LobbyMenu } from '../client/menu/LobbyMenu';
import type { RoomInfo } from '../shared/types';

export class LobbyState implements GameState {
  readonly name = 'lobby';
  private lobbyMenu: LobbyMenu | null = null;
  private context: StateContext | null = null;
  private roomInfo: RoomInfo | null = null;

  async enter(context: StateContext): Promise<void> {
    this.context = context;

    // Listen for room events
    context.eventBus.on('network:room-joined', this.handleRoomJoined);
    context.eventBus.on('network:player-joined', this.handlePlayerJoined);
    context.eventBus.on('network:player-left', this.handlePlayerLeft);
    context.eventBus.on('race:countdown-start', this.handleRaceStart);
  }

  update(_dt: number): void {
    // Lobby is event-driven, no updates needed
  }

  async exit(): Promise<void> {
    if (this.context) {
      this.context.eventBus.off('network:room-joined', this.handleRoomJoined);
      this.context.eventBus.off('network:player-joined', this.handlePlayerJoined);
      this.context.eventBus.off('network:player-left', this.handlePlayerLeft);
      this.context.eventBus.off('race:countdown-start', this.handleRaceStart);
    }

    if (this.lobbyMenu) {
      this.lobbyMenu.hide();
      this.lobbyMenu = null;
    }

    this.context = null;
    this.roomInfo = null;
  }

  private handleRoomJoined = (_data: { roomId: string; playerId: string }) => {
    // Room info will be provided via context data
    if (this.context?.data?.roomInfo) {
      this.roomInfo = this.context.data.roomInfo as RoomInfo;
      this.showLobby();
    }
  };

  private handlePlayerJoined = (data: { playerId: string; playerName: string }) => {
    if (this.roomInfo) {
      this.roomInfo.players.push({
        id: data.playerId,
        name: data.playerName,
        isHost: false,
      });
      this.updateLobby();
    }
  };

  private handlePlayerLeft = (data: { playerId: string }) => {
    if (this.roomInfo) {
      this.roomInfo.players = this.roomInfo.players.filter((p) => p.id !== data.playerId);
      this.updateLobby();
    }
  };

  private handleRaceStart = () => {
    if (this.context) {
      this.context.eventBus.emit('game:state-change', { from: 'lobby', to: 'countdown' });
    }
  };

  private showLobby(): void {
    if (!this.roomInfo || !this.context) return;

    const isHost = this.context.data?.isHost ?? false;

    this.lobbyMenu = new LobbyMenu(this.roomInfo, isHost, {
      onStartRace: () => {
        // Network service will handle this
      },
      onLeaveLobby: () => {
        if (this.context) {
          this.context.eventBus.emit('game:state-change', { from: 'lobby', to: 'menu' });
        }
      },
      onChangeLaps: (laps: number) => {
        if (this.roomInfo) {
          this.roomInfo.totalLaps = laps;
        }
      },
    });

    this.lobbyMenu.show();
  }

  private updateLobby(): void {
    if (this.lobbyMenu && this.roomInfo) {
      this.lobbyMenu.updateRoomInfo(this.roomInfo);
    }
  }
}
