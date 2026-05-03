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
    console.log('[LobbyState] Entering, context.data:', context.data);

    // Listen for room events
    context.eventBus.on('network:room-joined', this.handleRoomJoined);
    context.eventBus.on('network:room-created', this.handleRoomCreated);
    context.eventBus.on('network:player-joined', this.handlePlayerJoined);
    context.eventBus.on('network:player-left', this.handlePlayerLeft);
    context.eventBus.on('race:countdown-start', this.handleRaceStart);

    // Get network service
    const networkService = context.data?.serviceContainer?.resolve('network');
    if (!networkService) {
      console.error('[LobbyState] NetworkService not found');
      return;
    }

    // Connect to network if not connected
    try {
      await networkService.connect();
      console.log('[LobbyState] Network connected');
    } catch (error) {
      console.error('[LobbyState] Network connection failed:', error);
      context.eventBus.emit('error:fatal', { message: 'Failed to connect to server' });
      return;
    }

    // Check if we're creating or joining a room
    const { playerName, roomId } = context.data || {};

    if (roomId) {
      // Join existing room
      console.log('[LobbyState] Joining room:', roomId, 'as', playerName);
      networkService.joinRoom(roomId, playerName);
    } else if (playerName) {
      // Create new room
      console.log('[LobbyState] Creating room as', playerName);
      networkService.createRoom(playerName, 3); // Default 3 laps
    } else {
      console.error('[LobbyState] No playerName or roomId provided');
    }
  }

  update(_dt: number): void {
    // Lobby is event-driven, no updates needed
  }

  async exit(): Promise<void> {
    if (this.context) {
      this.context.eventBus.off('network:room-joined', this.handleRoomJoined);
      this.context.eventBus.off('network:room-created', this.handleRoomCreated);
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

  private handleRoomCreated = (data: { roomId: string; playerId: string }) => {
    console.log('[LobbyState] Room created event:', data);

    // Save playerId to context
    if (this.context) {
      this.context.data = { ...this.context.data, playerId: data.playerId };
    }

    // Create initial room info for host
    const playerName = this.context?.data?.playerName || 'Player';
    this.roomInfo = {
      roomId: data.roomId,
      hostId: data.playerId,
      players: [{
        id: data.playerId,
        name: playerName,
        isHost: true,
      }],
      totalLaps: 3,
      state: 'lobby',
    };

    // Show lobby UI
    this.showLobby();
  };

  private handleRoomJoined = (data: { roomId: string; playerId: string; roomInfo?: any }) => {
    console.log('[LobbyState] Room joined event:', data);

    // Save playerId to context
    if (this.context) {
      this.context.data = { ...this.context.data, playerId: data.playerId };
    }

    // Update room info from network event
    if (data.roomInfo) {
      this.roomInfo = data.roomInfo;
    } else if (!this.roomInfo) {
      // Create initial room info if not exists (guest joining)
      const playerName = this.context?.data?.playerName || 'Player';
      this.roomInfo = {
        roomId: data.roomId,
        hostId: '', // Will be updated when we get full room info
        players: [{
          id: data.playerId,
          name: playerName,
          isHost: false,
        }],
        totalLaps: 3,
        state: 'lobby',
      };
    }

    // Show or update lobby UI
    if (this.lobbyMenu) {
      this.updateLobby();
    } else {
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
      // Defer state change to avoid race condition during enter()
      setTimeout(() => {
        if (this.context) {
          this.context.eventBus.emit('game:request-state-change', { from: 'lobby', to: 'countdown' });
        }
      }, 0);
    }
  };

  private showLobby(): void {
    if (!this.roomInfo || !this.context) return;

    const isHost = this.roomInfo.players.some(p => p.isHost && p.id === this.context?.data?.playerId);

    this.lobbyMenu = new LobbyMenu(this.roomInfo, isHost, {
      onStartRace: () => {
        console.log('[LobbyState] Start race clicked');
        // Get network service and start race
        const networkService = this.context?.data?.serviceContainer?.resolve('network');
        if (networkService) {
          networkService.startRace();
        }
      },
      onLeaveLobby: () => {
        console.log('[LobbyState] Leave lobby clicked');
        if (this.context) {
          // Disconnect from network
          const networkService = this.context.data?.serviceContainer?.resolve('network');
          if (networkService) {
            networkService.leaveRoom();
          }
          this.context.eventBus.emit('game:request-state-change', { from: 'lobby', to: 'menu' });
        }
      },
      onChangeLaps: (laps: number) => {
        console.log('[LobbyState] Laps changed to', laps);
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
