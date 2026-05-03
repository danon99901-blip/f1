// Network service wrapping NetworkClient with reconnect logic

import { NetworkClient, type NetworkErrorType } from '../client/network/NetworkClient';
import type {
  HostMessage,
  ClientMessage,
} from '../shared/protocol';
import type { EventBus } from '../core/EventBus';
import type { Service } from '../core/ServiceContainer';

export interface NetworkServiceConfig {
  signalingUrl: string;
  eventBus: EventBus;
}

export class NetworkService implements Service {
  private client: NetworkClient | null = null;
  private config: NetworkServiceConfig;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private reconnectTimer: number | null = null;
  private isReconnecting = false;
  private isDisposed = false;

  // Network stats tracking
  private pingSamples: number[] = [];
  private pingInterval: number | null = null;
  private readonly maxPingSamples = 10;
  private hostMessageCounter = 0;
  private guestMessageCounter = 0;

  constructor(config: NetworkServiceConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.client) {
      console.warn('[NetworkService] Already connected');
      return;
    }

    this.client = new NetworkClient(this.config.signalingUrl, {
      onRoomCreated: (roomId, playerId) => {
        this.config.eventBus.emit('network:room-created', { roomId, playerId });
      },

      onRoomJoined: (roomInfo, playerId) => {
        this.config.eventBus.emit('network:room-joined', { roomId: roomInfo.roomId, playerId });
      },

      onPlayerJoined: (playerId, playerName) => {
        this.config.eventBus.emit('network:player-joined', { playerId, playerName });
      },

      onPlayerLeft: (playerId) => {
        this.config.eventBus.emit('network:player-left', { playerId });
      },

      onPlayerColorChanged: (playerId, color) => {
        this.config.eventBus.emit('network:player-color-changed', { playerId, color });
      },

      onRaceStart: (countdown) => {
        this.config.eventBus.emit('race:countdown-start', { seconds: countdown });
      },

      onHostMessage: (message) => {
        // Log every 50th snapshot to avoid spam
        if (message.type === 'snapshot') {
          if (!this.hostMessageCounter) this.hostMessageCounter = 0;
          this.hostMessageCounter++;
          if (this.hostMessageCounter % 50 === 0) {
            console.log(`[NetworkService] CALLBACK onHostMessage: Received snapshot #${this.hostMessageCounter}`, {
              tick: message.tick,
              playerCount: message.players.length
            });
          }
        } else {
          console.log(`[NetworkService] CALLBACK onHostMessage: ${message.type}`);
        }
        // Host messages are handled by game controllers
      },

      onGuestMessage: (guestId, message) => {
        // Log every 50th input to avoid spam
        if (message.type === 'input') {
          if (!this.guestMessageCounter) this.guestMessageCounter = 0;
          this.guestMessageCounter++;
          if (this.guestMessageCounter % 50 === 0) {
            console.log(`[NetworkService] CALLBACK onGuestMessage: Received input #${this.guestMessageCounter} from ${guestId}`, {
              seq: message.seq,
              throttle: message.throttle,
              steering: message.steer,
              brake: message.brake
            });
          }
        } else {
          console.log(`[NetworkService] CALLBACK onGuestMessage: ${message.type} from ${guestId}`);
        }
        // Guest messages are handled by game controllers
      },

      onError: (message, errorType) => {
        this.config.eventBus.emit('error:network', { message, errorType });
        this.handleDisconnect(message, errorType);
      },

      onConnectionStateChange: (state) => {
        if (state === 'connected') {
          this.reconnectAttempts = 0;
          this.config.eventBus.emit('network:connected', undefined);
        } else if (state === 'disconnected') {
          this.config.eventBus.emit('network:disconnected', { reason: 'Connection lost' });
        }
      },
    });

    try {
      await this.client.connect();
      this.startPingMonitoring();
    } catch (error) {
      this.config.eventBus.emit('error:network', {
        message: error instanceof Error ? error.message : 'Connection failed',
      });
      throw error;
    }
  }

  disconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    this.isReconnecting = false;

    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }

    this.reconnectAttempts = 0;
    this.pingSamples = [];
  }

  createRoom(playerName: string, totalLaps: number): void {
    if (!this.client) {
      throw new Error('NetworkService not connected');
    }
    this.client.createRoom(playerName, totalLaps);
  }

  joinRoom(roomId: string, playerName: string): void {
    if (!this.client) {
      throw new Error('NetworkService not connected');
    }
    this.client.joinRoom(roomId, playerName);
  }

  leaveRoom(): void {
    if (this.client) {
      this.client.leaveRoom();
    }
  }

  startRace(): void {
    if (!this.client) {
      throw new Error('NetworkService not connected');
    }
    this.client.startRace();
  }

  updatePlayerColor(color: number): void {
    if (!this.client) {
      throw new Error('NetworkService not connected');
    }
    this.client.updatePlayerColor(color);
  }

  broadcastToGuests(message: HostMessage): void {
    if (this.client) {
      this.client.broadcastToGuests(message);
    }
  }

  sendToHost(message: ClientMessage): void {
    if (this.client) {
      this.client.sendToHost(message);
    }
  }

  getClient(): NetworkClient | null {
    return this.client;
  }

  isHost(): boolean {
    return this.client?.isHost() ?? false;
  }

  getPlayerId(): string | null {
    return this.client?.getPlayerId() ?? null;
  }

  private handleDisconnect(_reason: string, errorType?: NetworkErrorType): void {
    // Prevent infinite loop - check if already reconnecting or disposed
    if (this.isReconnecting || this.isDisposed) {
      return;
    }

    // Don't attempt reconnect for certain error types
    if (errorType === 'room_not_found' || errorType === 'host_disconnected') {
      console.log(`[NetworkService] Not reconnecting due to error type: ${errorType}`);
      this.config.eventBus.emit('error:fatal', {
        message: `Cannot reconnect: ${errorType}`,
      });
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.config.eventBus.emit('error:fatal', {
        message: `Failed to reconnect after ${this.maxReconnectAttempts} attempts`,
      });
      return;
    }

    this.reconnectAttempts++;
    this.isReconnecting = true;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    this.config.eventBus.emit('network:reconnecting', { attempt: this.reconnectAttempts });

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnect();
    }, delay);
  }

  private async reconnect(): Promise<void> {
    // Double-check state before attempting reconnect
    if (this.isDisposed || !this.isReconnecting) {
      return;
    }

    try {
      await this.connect();
      this.isReconnecting = false;
    } catch (error) {
      console.error('[NetworkService] Reconnect failed:', error);
      this.isReconnecting = false;
      // handleDisconnect will be called again by the error handler if needed
    }
  }

  dispose(): void {
    this.isDisposed = true;
    this.disconnect();
  }

  private startPingMonitoring(): void {
    this.pingInterval = window.setInterval(() => {
      this.measurePing();
    }, 5000);
  }

  private measurePing(): void {
    if (!this.client) return;

    // Send a ping message through the data channel
    // In a real implementation, you'd send a ping message and wait for pong
    // For now, we'll estimate based on WebRTC stats
    this.estimatePingFromStats();
  }

  private async estimatePingFromStats(): Promise<void> {
    if (!this.client) return;

    try {
      const stats = await this.client.getConnectionStats();
      if (stats && stats.roundTripTime !== undefined) {
        const ping = stats.roundTripTime * 1000; // Convert to ms
        this.pingSamples.push(ping);
        if (this.pingSamples.length > this.maxPingSamples) {
          this.pingSamples.shift();
        }
      }
    } catch (error) {
      // Stats not available, ignore
    }
  }

  getNetworkStats(): { ping: number; jitter: number } | null {
    if (this.pingSamples.length === 0) return null;

    const avgPing = this.pingSamples.reduce((a, b) => a + b, 0) / this.pingSamples.length;

    // Calculate jitter (variance in ping)
    const jitter = this.pingSamples.length > 1
      ? Math.sqrt(
          this.pingSamples
            .map(p => Math.pow(p - avgPing, 2))
            .reduce((a, b) => a + b, 0) / this.pingSamples.length
        )
      : 0;

    return { ping: avgPing, jitter };
  }
}
