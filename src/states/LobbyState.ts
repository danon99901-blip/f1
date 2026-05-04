// Lobby state - multiplayer lobby

import type { GameState, StateContext } from '../core/GameStateMachine';
import { LobbyMenu } from '../client/menu/LobbyMenu';
import type { RoomInfo } from '../shared/types';
import type { NetworkService } from '../services/NetworkService';
import type { NetworkErrorType } from '../client/network/NetworkClient';

export class LobbyState implements GameState {
  readonly name = 'lobby';
  private lobbyMenu: LobbyMenu | null = null;
  private context: StateContext | null = null;
  private roomInfo: RoomInfo | null = null;
  private networkService: NetworkService | null = null;

  async enter(context: StateContext): Promise<void> {
    this.context = context;
    console.log('[LobbyState] Entering, context.data:', context.data);

    // Listen for room events
    context.eventBus.on('network:room-joined', this.handleRoomJoined);
    context.eventBus.on('network:room-created', this.handleRoomCreated);
    context.eventBus.on('network:player-joined', this.handlePlayerJoined);
    context.eventBus.on('network:player-left', this.handlePlayerLeft);
    context.eventBus.on('network:player-color-changed', this.handlePlayerColorChanged);
    context.eventBus.on('race:countdown-start', this.handleRaceStart);
    context.eventBus.on('error:network', this.handleNetworkError);

    // Get network service with explicit checks
    if (!context.data) {
      console.error('[LobbyState] Context data not found');
      return;
    }

    if (!context.data.serviceContainer) {
      console.error('[LobbyState] ServiceContainer not found');
      return;
    }

    // Resolve and cache NetworkService
    let networkService: NetworkService;
    try {
      networkService = await context.data.serviceContainer.resolve('network');

      // Validate the resolved service
      if (!networkService) {
        throw new Error('NetworkService resolved to null or undefined');
      }

      console.log('[LobbyState] NetworkService resolved:', networkService);
      console.log('[LobbyState] NetworkService type:', typeof networkService);
      console.log('[LobbyState] NetworkService constructor:', networkService.constructor.name);
      console.log('[LobbyState] Has connect method:', typeof networkService.connect);

      if (typeof networkService.connect !== 'function') {
        throw new Error(`NetworkService.connect is not a function (type: ${typeof networkService.connect})`);
      }

      this.networkService = networkService;
    } catch (error) {
      console.error('[LobbyState] Failed to resolve NetworkService:', error);
      context.eventBus.emit('error:fatal', { message: 'Failed to initialize network service' });
      return;
    }

    // Connect to network if not connected
    try {
      await networkService.connect();
      console.log('[LobbyState] Network connected');
    } catch (error) {
      console.error('[LobbyState] Network connection failed:', error);
      context.eventBus.emit('error:fatal', { message: 'Failed to connect to server' });
      this.networkService = null;
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
      this.context.eventBus.off('network:player-color-changed', this.handlePlayerColorChanged);
      this.context.eventBus.off('race:countdown-start', this.handleRaceStart);
      this.context.eventBus.off('error:network', this.handleNetworkError);
    }

    if (this.lobbyMenu) {
      this.lobbyMenu.hide();
      this.lobbyMenu = null;
    }

    this.networkService = null;
    this.context = null;
    this.roomInfo = null;
  }

  private handleRoomCreated = (data: { roomId: string; playerId: string }) => {
    console.log('[LobbyState] Room created event:', data);

    // Defer UI updates to avoid race condition during state transition
    setTimeout(() => {
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
          carColor: 0xe10600, // Default Ferrari red
        }],
        totalLaps: 3,
        state: 'lobby',
      };

      // Show lobby UI
      this.showLobby();
    }, 0);
  };

  private handleRoomJoined = (data: { roomId: string; playerId: string; roomInfo?: RoomInfo }) => {
    console.log('[LobbyState] Room joined event:', data);

    // Defer UI updates to avoid race condition during state transition
    setTimeout(() => {
      // Save playerId to context
      if (this.context) {
        this.context.data = { ...this.context.data, playerId: data.playerId };
      }

      // Update room info from network event. The signaling server sends the full
      // player list with the room_joined message; NetworkService now forwards it
      // intact via data.roomInfo. The fallback below only fires if the event was
      // emitted without roomInfo (legacy code path) and ensures we don't crash —
      // but note that without the full player list, opponents won't render.
      if (data.roomInfo) {
        this.roomInfo = data.roomInfo;
      } else if (!this.roomInfo) {
        console.warn('[LobbyState] room-joined event missing roomInfo; falling back to single-player room shape. Remote players will be missing.');
        const playerName = this.context?.data?.playerName || 'Player';
        this.roomInfo = {
          roomId: data.roomId,
          hostId: '', // Will be updated when we get full room info
          players: [{
            id: data.playerId,
            name: playerName,
            isHost: false,
            carColor: 0xe10600, // Default Ferrari red
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
    }, 0);
  };

  private handlePlayerJoined = (data: { playerId: string; playerName: string; carColor?: number }) => {
    if (this.roomInfo) {
      this.roomInfo.players.push({
        id: data.playerId,
        name: data.playerName,
        isHost: false,
        carColor: data.carColor || 0xe10600,
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

  private handlePlayerColorChanged = (data: { playerId: string; color: number }) => {
    if (this.roomInfo) {
      const player = this.roomInfo.players.find((p) => p.id === data.playerId);
      if (player) {
        player.carColor = data.color;
        this.updateLobby();
      }
    }
  };

  private handleRaceStart = () => {
    if (this.context && this.roomInfo) {
      // Defer state change to avoid race condition during enter()
      setTimeout(() => {
        if (this.context && this.roomInfo) {
          // Determine game mode based on whether we're host or guest
          const isHost = this.roomInfo.players.some(p => p.isHost && p.id === this.context?.data?.playerId);
          const gameMode = isHost ? 'multi_host' : 'multi_guest';

          // Update context with multiplayer data
          this.context.data = {
            ...this.context.data,
            gameMode,
            totalLaps: this.roomInfo.totalLaps,
            roomInfo: this.roomInfo,
          };

          console.log('[LobbyState] Transitioning to countdown with gameMode:', gameMode);
          this.context.eventBus.emit('game:request-state-change', { from: 'lobby', to: 'countdown' });
        }
      }, 0);
    }
  };

  private handleNetworkError = (data: { message: string; errorType?: NetworkErrorType }) => {
    console.log('[LobbyState] Network error:', data.message, 'type:', data.errorType);

    // Handle specific error types
    switch (data.errorType) {
      case 'room_not_found':
        alert(`Room not found. The room may have been closed or the code is incorrect.\n\nReturning to menu...`);
        if (this.networkService) {
          this.networkService.disconnect();
        }
        this.context?.eventBus.emit('game:request-state-change', { from: 'lobby', to: 'menu' });
        break;

      case 'host_disconnected':
        alert(`Host disconnected. The room has been closed.\n\nReturning to menu...`);
        if (this.networkService) {
          this.networkService.disconnect();
        }
        this.context?.eventBus.emit('game:request-state-change', { from: 'lobby', to: 'menu' });
        break;

      case 'race_already_started':
        alert(`This race has already started. You cannot join now.\n\nReturning to menu...`);
        if (this.networkService) {
          this.networkService.disconnect();
        }
        this.context?.eventBus.emit('game:request-state-change', { from: 'lobby', to: 'menu' });
        break;

      case 'room_full':
        alert(`This room is full (maximum 4 players).\n\nReturning to menu...`);
        if (this.networkService) {
          this.networkService.disconnect();
        }
        this.context?.eventBus.emit('game:request-state-change', { from: 'lobby', to: 'menu' });
        break;

      case 'only_host_can_start':
        alert('Only the host can start the race.');
        break;

      case 'need_more_players':
        alert('Need at least 2 players to start the race.');
        break;

      default:
        // For unknown errors, just log them
        console.error('[LobbyState] Unknown network error:', data.message);
        break;
    }
  };

  private showLobby(): void {
    if (!this.roomInfo || !this.context) return;

    const isHost = this.roomInfo.players.some(p => p.isHost && p.id === this.context?.data?.playerId);
    const localPlayerId = this.context.data?.playerId || '';

    this.lobbyMenu = new LobbyMenu(this.roomInfo, isHost, {
      onStartRace: () => {
        console.log('[LobbyState] Start race clicked');
        if (this.networkService) {
          this.networkService.startRace();
        }
      },
      onLeaveLobby: () => {
        console.log('[LobbyState] Leave lobby clicked');
        if (this.networkService) {
          this.networkService.leaveRoom();
        }
        this.context?.eventBus.emit('game:request-state-change', { from: 'lobby', to: 'menu' });
      },
      onChangeLaps: (laps: number) => {
        console.log('[LobbyState] Laps changed to', laps);
        if (this.roomInfo) {
          this.roomInfo.totalLaps = laps;
        }
      },
      onColorChange: (color: number) => {
        console.log('[LobbyState] Color changed to', color);
        if (this.roomInfo && this.networkService) {
          // Update local player color in room info
          const player = this.roomInfo.players.find(p => p.id === localPlayerId);
          if (player) {
            player.carColor = color;
            this.updateLobby();
          }
          // Broadcast color change to other players
          this.networkService.updatePlayerColor(color);
        }
      },
    }, localPlayerId);

    this.lobbyMenu.show();
  }

  private updateLobby(): void {
    if (this.lobbyMenu && this.roomInfo) {
      this.lobbyMenu.updateRoomInfo(this.roomInfo);
    }
  }
}
