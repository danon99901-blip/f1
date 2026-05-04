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
    let totalChannels = 0;

    this.dataChannels.forEach((channel, peerId) => {
      totalChannels++;
      if (channel.readyState === 'open') {
        try {
          channel.send(JSON.stringify(message));
          sentCount++;
        } catch (error) {
          console.error(`[Network] Failed to send ${message.type} to ${peerId}:`, error);
        }
      } else {
        console.warn(`[Network] Data channel to ${peerId} not open (state: ${channel.readyState})`);
      }
    });

    // Log warning if no messages were sent
    if (totalChannels > 0 && sentCount === 0) {
      console.warn(`[Network] broadcastToGuests: No messages sent! Total channels: ${totalChannels}, sent: ${sentCount}`);
    }
  }

  // Guest sends message to host
  sendToHost(message: ClientMessage): void {
    if (this.mode !== 'guest') return;

    const hostChannel = Array.from(this.dataChannels.values())[0];
    if (!hostChannel) {
      console.warn('[Network] sendToHost: No data channel to host exists');
      return;
    }

    if (hostChannel.readyState !== 'open') {
      console.warn(`[Network] sendToHost: Data channel not open (state: ${hostChannel.readyState})`);
      return;
    }

    try {
      hostChannel.send(JSON.stringify(message));
    } catch (error) {
      console.error(`[Network] Failed to send ${message.type} to host:`, error);
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
        console.log(`[Network] player_joined: ${message.playerId} (${message.playerName}), my mode=${this.mode}`);
        this.callbacks.onPlayerJoined(message.playerId, message.playerName);

        // If we're host, accept connection from new guest
        if (this.mode === 'host') {
          console.log(`[Network] Host creating peer connection for new guest ${message.playerId}`);
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

  /**
   * Build the ICE server list for RTCPeerConnection.
   *
   * Always includes Google's public STUN servers. Additionally, if a TURN server is
   * configured via Vite env vars, it is appended. TURN is REQUIRED for users behind
   * symmetric NAT (common on mobile carriers, corporate networks, dorms) — without it,
   * peers will silently fail to connect after a ~30s ICE timeout.
   *
   * Configure in `.env.local` (or platform env vars):
   *   VITE_TURN_URL=turn:turn.example.com:3478
   *   VITE_TURN_USERNAME=user
   *   VITE_TURN_CREDENTIAL=password
   *
   * Free options: Metered (metered.ca), Xirsys, or self-hosted coturn.
   */
  private static buildIceServers(): RTCIceServer[] {
    const servers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];

    const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined;
    const turnUsername = import.meta.env.VITE_TURN_USERNAME as string | undefined;
    const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;

    if (turnUrl && turnUsername && turnCredential) {
      servers.push({
        urls: turnUrl,
        username: turnUsername,
        credential: turnCredential,
      });
      console.log('[Network] TURN server configured:', turnUrl);
    } else {
      console.warn('[Network] No TURN server configured — peers behind symmetric NAT may fail to connect. Set VITE_TURN_URL/USERNAME/CREDENTIAL.');
    }

    return servers;
  }

  private async createPeerConnection(peerId: string, initiator: boolean): Promise<void> {
    const pc = new RTCPeerConnection({
      iceServers: NetworkClient.buildIceServers(),
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

    // ICE state transitions are the single most useful signal for diagnosing "guests
    // can't see each other" bugs. We log every transition with timing so you can tell
    // a healthy `new → checking → connected` sequence apart from the silent
    // `new → checking → failed` that happens behind symmetric NAT without a TURN
    // server. If you see `failed` here, configure VITE_TURN_URL.
    const iceStartTime = performance.now();
    let lastIceState: RTCIceConnectionState | null = null;
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      const elapsed = Math.round(performance.now() - iceStartTime);
      console.log(`[Network] ICE to ${peerId}: ${lastIceState ?? 'null'} → ${state} (+${elapsed}ms)`);
      lastIceState = state;

      if (state === 'failed') {
        console.error(
          `[Network] ICE FAILED to ${peerId} after ${elapsed}ms. ` +
          `Likely cause: symmetric NAT with no TURN server. ` +
          `Set VITE_TURN_URL/USERNAME/CREDENTIAL in .env.local.`
        );
      } else if (state === 'disconnected') {
        console.warn(`[Network] ICE disconnected to ${peerId} (+${elapsed}ms) — may recover automatically.`);
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log(`[Network] ICE gathering to ${peerId}: ${pc.iceGatheringState}`);
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
      console.log(`[Network] Data channel open with ${peerId}, mode: ${this.mode}`);
    };

    channel.onclose = () => {
      console.log(`[Network] Data channel closed with ${peerId}`);
      this.dataChannels.delete(peerId);
    };

    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (this.mode === 'host') {
          // Host receiving message from guest
          this.callbacks.onGuestMessage(peerId, message as ClientMessage);
        } else {
          // Guest receiving message from host
          this.callbacks.onHostMessage(message as HostMessage);
        }
      } catch (err) {
        console.error('[Network] Failed to parse data channel message:', err);
      }
    };

    channel.onerror = (error) => {
      console.error(`[Network] Data channel error with ${peerId}:`, error);
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
