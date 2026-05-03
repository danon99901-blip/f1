// Network client for P2P multiplayer communication

import type {
  SignalingClientMessage,
  SignalingServerMessage,
  ClientMessage,
  HostMessage,
} from '../../shared/protocol';
import type { RoomInfo } from '../../shared/types';

type NetworkMode = 'signaling' | 'host' | 'guest';

export interface NetworkClientCallbacks {
  onRoomCreated: (roomId: string, playerId: string) => void;
  onRoomJoined: (roomInfo: RoomInfo, playerId: string) => void;
  onPlayerJoined: (playerId: string, playerName: string) => void;
  onPlayerLeft: (playerId: string) => void;
  onPlayerColorChanged?: (playerId: string, color: number) => void;
  onRaceStart: (countdown: number) => void;
  onHostMessage: (message: HostMessage) => void;
  onGuestMessage: (guestId: string, message: ClientMessage) => void;
  onError: (message: string) => void;
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

    this.dataChannels.forEach((channel) => {
      if (channel.readyState === 'open') {
        channel.send(JSON.stringify(message));
      }
    });
  }

  // Guest sends message to host
  sendToHost(message: ClientMessage): void {
    if (this.mode !== 'guest') return;

    const hostChannel = Array.from(this.dataChannels.values())[0];
    if (hostChannel && hostChannel.readyState === 'open') {
      hostChannel.send(JSON.stringify(message));
    }
  }

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
        this.callbacks.onError(message.message);
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
        this.callbacks.onError(`Connection to ${peerId} failed`);
        this.closePeerConnection(peerId);
      } else if (pc.connectionState === 'disconnected') {
        console.warn(`[Network] Connection to ${peerId} disconnected`);
        if (this.callbacks.onConnectionStateChange) {
          this.callbacks.onConnectionStateChange('disconnected');
        }
        this.callbacks.onError(`Connection to ${peerId} lost`);
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
      console.log(`[Network] Data channel open with ${peerId}`);
    };

    channel.onclose = () => {
      console.log(`[Network] Data channel closed with ${peerId}`);
      this.dataChannels.delete(peerId);
    };

    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (this.mode === 'host') {
          // Host receives client messages
          this.callbacks.onGuestMessage(peerId, message as ClientMessage);
        } else {
          // Guest receives host messages
          this.callbacks.onHostMessage(message as HostMessage);
        }
      } catch (err) {
        console.error('[Network] Failed to parse data channel message:', err);
      }
    };
  }

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
