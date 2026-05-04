// Network client for P2P multiplayer communication

import type {
  SignalingClientMessage,
  SignalingServerMessage,
  ClientMessage,
  HostMessage,
} from '../../shared/protocol';
import type { RoomInfo } from '../../shared/types';

type NetworkMode = 'signaling' | 'host' | 'guest';

export type NetworkErrorType =
  | 'room_not_found'
  | 'race_already_started'
  | 'room_full'
  | 'host_disconnected'
  | 'only_host_can_start'
  | 'need_more_players'
  | 'connection_failed'
  | 'unknown';

export interface NetworkClientCallbacks {
  onRoomCreated: (roomId: string, playerId: string) => void;
  onRoomJoined: (roomInfo: RoomInfo, playerId: string) => void;
  onPlayerJoined: (playerId: string, playerName: string) => void;
  onPlayerLeft: (playerId: string) => void;
  onPlayerColorChanged?: (playerId: string, color: number) => void;
  onRaceStart: (countdown: number) => void;
  onHostMessage: (message: HostMessage) => void;
  onGuestMessage: (guestId: string, message: ClientMessage) => void;
  onError: (message: string, errorType: NetworkErrorType) => void;
  onConnectionStateChange?: (state: 'connected' | 'connecting' | 'disconnected') => void;
}

export class NetworkClient {
  private signalingWs: WebSocket | null = null;
  private peerConnections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();
  private mode: NetworkMode = 'signaling';
  private playerId: string | null = null;
  private roomId: string | null = null;
  private callbacks: NetworkClientCallbacks;
  private signalingUrl: string;

  // Reconnection state
  private lastPlayerName: string | null = null;
  private lastTotalLaps: number | null = null;

  constructor(signalingUrl: string, callbacks: NetworkClientCallbacks) {
    this.signalingUrl = signalingUrl;
    this.callbacks = callbacks;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 10000); // 10 second timeout

      this.signalingWs = new WebSocket(this.signalingUrl);

      this.signalingWs.onopen = () => {
        clearTimeout(timeout);
        console.log('[Network] Connected to signaling server');
        if (this.callbacks.onConnectionStateChange) {
          this.callbacks.onConnectionStateChange('connected');
        }
        resolve();
      };

      this.signalingWs.onerror = (err) => {
        clearTimeout(timeout);
        console.error('[Network] Signaling connection error:', err);
        if (this.callbacks.onConnectionStateChange) {
          this.callbacks.onConnectionStateChange('disconnected');
        }
        reject(new Error('Failed to connect to signaling server'));
      };

      this.signalingWs.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as SignalingServerMessage;
          this.handleSignalingMessage(message);
        } catch (err) {
          console.error('[Network] Failed to parse signaling message:', err);
        }
      };

      this.signalingWs.onclose = () => {
        console.log('[Network] Disconnected from signaling server');
        if (this.callbacks.onConnectionStateChange) {
          this.callbacks.onConnectionStateChange('disconnected');
        }
      };
    });
  }

  createRoom(playerName: string, totalLaps: number): void {
    this.mode = 'host';
    this.lastPlayerName = playerName;
    this.lastTotalLaps = totalLaps;
    this.sendSignaling({
      type: 'create_room',
      playerName,
      totalLaps,
    });
  }

  joinRoom(roomId: string, playerName: string): void {
    this.mode = 'guest';
    this.roomId = roomId;
    this.lastPlayerName = playerName;
    this.sendSignaling({
      type: 'join_room',
      roomId,
      playerName,
    });
  }

  startRace(): void {
    if (this.mode !== 'host') {
      console.warn('[Network] Only host can start race');
      return;
    }
    this.sendSignaling({
      type: 'start_race',
    });
  }

  updatePlayerColor(color: number): void {
    this.sendSignaling({
      type: 'update_color',
      color,
    });
  }

  leaveRoom(): void {
    this.sendSignaling({
      type: 'leave_room',
    });
    this.cleanup();
  }

  // Host broadcasts message to all guests
  broadcastToGuests(message: HostMessage): void {
    if (this.mode !== 'host') return;

    let sentCount = 0;
    let closedCount = 0;
    const channelStates: { peerId: string; state: string; sent: boolean }[] = [];

    this.dataChannels.forEach((channel, peerId) => {
      const state = channel.readyState;
      let sent = false;

      if (state === 'open') {
        try {
          channel.send(JSON.stringify(message));
          sentCount++;
          sent = true;
        } catch (error) {
          console.error(`[Network] HOST BROADCAST ERROR: Failed to send to ${peerId}:`, error);
        }
      } else {
        closedCount++;
        console.warn(`[Network] Cannot send to ${peerId}: channel state is ${state}`);
      }

      channelStates.push({ peerId, state, sent });
    });

    // Log snapshot broadcasts (most frequent)
    if (message.type === 'snapshot') {
      // Log every 50th snapshot to avoid spam
      if (!this.snapshotCounter) this.snapshotCounter = 0;
      this.snapshotCounter++;
      if (this.snapshotCounter % 50 === 0) {
        console.log(`[Network] HOST BROADCAST #${this.snapshotCounter}: Sent ${sentCount} snapshots (${closedCount} channels closed). Total channels: ${this.dataChannels.size}`, {
          tick: message.tick,
          playerCount: message.players.length,
          timestamp: message.timestamp,
          channelStates: channelStates
        });
      }
    } else {
      console.log(`[Network] HOST BROADCAST: ${message.type} to ${sentCount} guests (${closedCount} channels closed). Total channels: ${this.dataChannels.size}`, {
        channelStates: channelStates
      });
    }
  }

  private snapshotCounter = 0;

  // Guest sends message to host
  sendToHost(message: ClientMessage): void {
    if (this.mode !== 'guest') {
      console.warn(`[Network] GUEST SEND BLOCKED: Not in guest mode (current mode: ${this.mode})`);
      return;
    }

    const hostChannel = Array.from(this.dataChannels.values())[0];

    // Log channel state BEFORE attempting to send
    if (!hostChannel) {
      console.error(`[Network] GUEST SEND FAILED: No data channel exists. Total channels: ${this.dataChannels.size}`);
      return;
    }

    if (hostChannel.readyState !== 'open') {
      console.warn(`[Network] GUEST SEND FAILED: Channel state is "${hostChannel.readyState}" (not "open")`);
      return;
    }

    // Log input sends (most frequent)
    if (message.type === 'input') {
      // Log every 50th input to avoid spam
      if (!this.inputCounter) this.inputCounter = 0;
      this.inputCounter++;
      if (this.inputCounter % 50 === 0) {
        console.log(`[Network] GUEST SEND (before): Sending input #${this.inputCounter} to host. Channel state: ${hostChannel.readyState}. Data:`, {
          seq: message.seq,
          throttle: message.throttle.toFixed(3),
          steering: message.steer.toFixed(3),
          brake: message.brake.toFixed(3),
          timestamp: message.timestamp
        });
      }
    } else {
      console.log(`[Network] GUEST SEND (before): Sending ${message.type} to host. Channel state: ${hostChannel.readyState}`);
    }

    // Actually send the message
    try {
      hostChannel.send(JSON.stringify(message));

      // Confirm successful send for non-input messages
      if (message.type !== 'input') {
        console.log(`[Network] GUEST SEND (after): Successfully sent ${message.type}`);
      }
    } catch (error) {
      console.error(`[Network] GUEST SEND ERROR: Failed to send ${message.type}:`, error);
    }
  }

  private inputCounter = 0;

  private handleSignalingMessage(message: SignalingServerMessage): void {
    switch (message.type) {
      case 'room_created':
        this.playerId = message.playerId;
        this.roomId = message.roomId;
        this.callbacks.onRoomCreated(message.roomId, message.playerId);
        break;

      case 'room_joined':
        this.playerId = message.playerId;
        this.roomId = message.roomId;
        const roomInfo: RoomInfo = {
          roomId: message.roomId,
          hostId: message.players.find((p) => p.isHost)?.id || '',
          players: message.players,
          totalLaps: message.totalLaps,
          state: 'lobby',
        };
        this.callbacks.onRoomJoined(roomInfo, message.playerId);

        // If we're a guest, initiate connection to host
        if (this.mode === 'guest') {
          const host = message.players.find((p) => p.isHost);
          if (host) {
            this.createPeerConnection(host.id, true);
          }
        }
        break;

      case 'player_joined':
        this.callbacks.onPlayerJoined(message.playerId, message.playerName);

        // If we're host, accept connection from new guest
        if (this.mode === 'host') {
          this.createPeerConnection(message.playerId, false);
        }
        break;

      case 'player_left':
        this.callbacks.onPlayerLeft(message.playerId);
        this.closePeerConnection(message.playerId);
        break;

      case 'player_color_changed':
        this.callbacks.onPlayerColorChanged?.(message.playerId, message.color);
        break;

      case 'race_start':
        this.callbacks.onRaceStart(message.countdown);
        break;

      case 'signaling_offer':
        this.handleOffer(message.targetId, message.offer);
        break;

      case 'signaling_answer':
        this.handleAnswer(message.targetId, message.answer);
        break;

      case 'signaling_ice':
        this.handleIceCandidate(message.targetId, message.candidate);
        break;

      case 'error':
        this.callbacks.onError(message.message, this.mapErrorMessageToType(message.message));
        break;
    }
  }

  private async createPeerConnection(peerId: string, initiator: boolean): Promise<void> {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
      iceCandidatePoolSize: 10,
    });

    this.peerConnections.set(peerId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignaling({
          type: 'signaling_ice',
          targetId: peerId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[Network] ICE connection to ${peerId}: ${pc.iceConnectionState}`);
    };

    pc.onconnectionstatechange = () => {
      console.log(`[Network] Connection to ${peerId}: ${pc.connectionState}`);

      if (pc.connectionState === 'connected') {
        if (this.callbacks.onConnectionStateChange) {
          this.callbacks.onConnectionStateChange('connected');
        }
      } else if (pc.connectionState === 'failed') {
        console.warn(`[Network] Connection to ${peerId} failed`);
        if (this.callbacks.onConnectionStateChange) {
          this.callbacks.onConnectionStateChange('disconnected');
        }
        this.callbacks.onError(`Connection to ${peerId} failed`, 'connection_failed');
        this.closePeerConnection(peerId);
      } else if (pc.connectionState === 'disconnected') {
        console.warn(`[Network] Connection to ${peerId} disconnected`);
        if (this.callbacks.onConnectionStateChange) {
          this.callbacks.onConnectionStateChange('disconnected');
        }
        this.callbacks.onError(`Connection to ${peerId} lost`, 'connection_failed');
        this.closePeerConnection(peerId);
      }
    };

    if (initiator) {
      const channel = pc.createDataChannel('game', {
        ordered: false,
        maxRetransmits: 0,
      });
      this.setupDataChannel(peerId, channel);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.sendSignaling({
        type: 'signaling_offer',
        targetId: peerId,
        offer: offer,
      });
    } else {
      pc.ondatachannel = (event) => {
        this.setupDataChannel(peerId, event.channel);
      };
    }
  }

  private setupDataChannel(peerId: string, channel: RTCDataChannel): void {
    this.dataChannels.set(peerId, channel);

    channel.onopen = () => {
      console.log(`[Network] ✅ Data channel OPEN with ${peerId}. Mode: ${this.mode}, Total channels: ${this.dataChannels.size}`);
    };

    channel.onclose = () => {
      console.log(`[Network] ❌ Data channel CLOSED with ${peerId}. Mode: ${this.mode}`);
      this.dataChannels.delete(peerId);
    };

    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (this.mode === 'host') {
          // Host receives client messages
          const clientMsg = message as ClientMessage;

          // Log received inputs (most frequent)
          if (clientMsg.type === 'input') {
            if (!this.receivedInputCounter) this.receivedInputCounter = 0;
            this.receivedInputCounter++;
            if (this.receivedInputCounter % 50 === 0) {
              console.log(`[Network] HOST RECEIVED: Input #${this.receivedInputCounter} from ${peerId}. Sample data:`, {
                seq: clientMsg.seq,
                throttle: clientMsg.throttle,
                steering: clientMsg.steer,
                brake: clientMsg.brake,
                timestamp: clientMsg.timestamp
              });
            }
          } else {
            console.log(`[Network] HOST RECEIVED: ${clientMsg.type} from ${peerId}`);
          }

          this.callbacks.onGuestMessage(peerId, clientMsg);
        } else {
          // Guest receives host messages
          const hostMsg = message as HostMessage;

          // Log received snapshots (most frequent)
          if (hostMsg.type === 'snapshot') {
            if (!this.receivedSnapshotCounter) this.receivedSnapshotCounter = 0;
            this.receivedSnapshotCounter++;
            if (this.receivedSnapshotCounter % 50 === 0) {
              console.log(`[Network] GUEST RECEIVED: Snapshot #${this.receivedSnapshotCounter} from host. Sample data:`, {
                tick: hostMsg.tick,
                playerCount: hostMsg.players.length,
                timestamp: hostMsg.timestamp
              });
            }
          } else {
            console.log(`[Network] GUEST RECEIVED: ${hostMsg.type} from host`);
          }

          this.callbacks.onHostMessage(hostMsg);
        }
      } catch (err) {
        console.error('[Network] Failed to parse data channel message:', err);
      }
    };
  }

  private receivedInputCounter = 0;
  private receivedSnapshotCounter = 0;

  private async handleOffer(fromId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.peerConnections.get(fromId);
    if (!pc) {
      console.warn(`[Network] No peer connection for ${fromId}`);
      return;
    }

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.sendSignaling({
      type: 'signaling_answer',
      targetId: fromId,
      answer: answer,
    });
  }

  private async handleAnswer(fromId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.peerConnections.get(fromId);
    if (!pc) {
      console.warn(`[Network] No peer connection for ${fromId}`);
      return;
    }

    await pc.setRemoteDescription(answer);
  }

  private async handleIceCandidate(
    fromId: string,
    candidate: RTCIceCandidateInit,
  ): Promise<void> {
    const pc = this.peerConnections.get(fromId);
    if (!pc) {
      console.warn(`[Network] No peer connection for ${fromId}`);
      return;
    }

    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  private closePeerConnection(peerId: string): void {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
    }

    const channel = this.dataChannels.get(peerId);
    if (channel) {
      channel.close();
      this.dataChannels.delete(peerId);
    }
  }

  private sendSignaling(message: SignalingClientMessage): void {
    if (this.signalingWs && this.signalingWs.readyState === WebSocket.OPEN) {
      this.signalingWs.send(JSON.stringify(message));
    }
  }

  private cleanup(): void {
    this.peerConnections.forEach((pc) => pc.close());
    this.peerConnections.clear();

    this.dataChannels.forEach((channel) => channel.close());
    this.dataChannels.clear();

    this.playerId = null;
    this.roomId = null;
  }

  disconnect(): void {
    this.cleanup();

    if (this.signalingWs) {
      this.signalingWs.close();
      this.signalingWs = null;
    }
  }

  getPlayerId(): string | null {
    return this.playerId;
  }

  getRoomId(): string | null {
    return this.roomId;
  }

  isHost(): boolean {
    return this.mode === 'host';
  }

  canReconnect(): boolean {
    return this.lastPlayerName !== null && (this.mode === 'host' ? this.lastTotalLaps !== null : this.roomId !== null);
  }

  reconnectToRoom(): void {
    if (!this.canReconnect()) {
      throw new Error('Cannot reconnect: missing room state');
    }

    if (this.mode === 'host' && this.lastPlayerName && this.lastTotalLaps !== null) {
      this.createRoom(this.lastPlayerName, this.lastTotalLaps);
    } else if (this.mode === 'guest' && this.roomId && this.lastPlayerName) {
      this.joinRoom(this.roomId, this.lastPlayerName);
    }
  }

  private mapErrorMessageToType(message: string): NetworkErrorType {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('room not found')) {
      return 'room_not_found';
    } else if (lowerMessage.includes('race already started')) {
      return 'race_already_started';
    } else if (lowerMessage.includes('room is full')) {
      return 'room_full';
    } else if (lowerMessage.includes('host disconnected') || lowerMessage.includes('room closed')) {
      return 'host_disconnected';
    } else if (lowerMessage.includes('only host can start')) {
      return 'only_host_can_start';
    } else if (lowerMessage.includes('need at least')) {
      return 'need_more_players';
    } else if (lowerMessage.includes('connection') || lowerMessage.includes('connect')) {
      return 'connection_failed';
    }

    return 'unknown';
  }

  async getConnectionStats(): Promise<{ roundTripTime?: number } | null> {
    // Get stats from the first peer connection (if any)
    const firstPeer = Array.from(this.peerConnections.values())[0];
    if (!firstPeer) return null;

    try {
      const stats = await firstPeer.getStats();
      let rtt: number | undefined;

      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          rtt = report.currentRoundTripTime;
        }
      });

      return { roundTripTime: rtt };
    } catch (error) {
      console.error('[Network] Failed to get stats:', error);
      return null;
    }
  }
}
