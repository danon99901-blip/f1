// Lightweight signaling server for P2P room management

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import type {
  SignalingClientMessage,
  SignalingServerMessage,
  CreateRoom,
  JoinRoom,
} from '../shared/protocol.js';

interface Player {
  id: string;
  name: string;
  carColor: number;
  ws: WebSocket;
  roomId: string | null;
}

interface Room {
  id: string;
  hostId: string;
  players: Map<string, Player>;
  totalLaps: number;
  state: 'lobby' | 'racing';
}

export class SignalingServer {
  private wss: WebSocketServer;
  private players = new Map<string, Player>();
  private rooms = new Map<string, Room>();
  private httpServer: any;

  constructor(port: number) {
    // Create HTTP server for logs endpoint
    this.httpServer = createServer((req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // Health check endpoint for Railway
      if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          service: 'f1-signaling-server',
          rooms: this.rooms.size,
          players: this.players.size,
          timestamp: new Date().toISOString()
        }));
        return;
      }

      if (req.method === 'POST' && req.url === '/log') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const { logs } = JSON.parse(body);
            logs.forEach((log: any) => {
              console.log(`[CLIENT ${log.level.toUpperCase()}] ${log.message}`, log.data || '');
            });
            res.writeHead(200);
            res.end('OK');
          } catch (error) {
            console.error('[Server] Failed to parse logs:', error);
            res.writeHead(400);
            res.end('Bad Request');
          }
        });
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    this.httpServer.listen(port);
    this.wss = new WebSocketServer({ server: this.httpServer });
    console.log(`[Signaling] Server listening on port ${port}`);

    this.wss.on('connection', (ws) => {
      const playerId = this.generateId();
      const player: Player = {
        id: playerId,
        name: '',
        carColor: 0xe10600, // Default Ferrari red
        ws,
        roomId: null,
      };
      this.players.set(playerId, player);

      console.log(`[Signaling] Player ${playerId} connected`);

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString()) as SignalingClientMessage;
          this.handleMessage(player, message);
        } catch (err) {
          console.error('[Signaling] Failed to parse message:', err);
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(player);
      });

      ws.on('error', (err) => {
        console.error(`[Signaling] WebSocket error for ${playerId}:`, err);
      });
    });
  }

  private handleMessage(player: Player, message: SignalingClientMessage): void {
    switch (message.type) {
      case 'create_room':
        this.handleCreateRoom(player, message);
        break;
      case 'join_room':
        this.handleJoinRoom(player, message);
        break;
      case 'leave_room':
        this.handleLeaveRoom(player);
        break;
      case 'start_race':
        this.handleStartRace(player);
        break;
      case 'update_color':
        this.handleUpdateColor(player, message);
        break;
      case 'signaling_offer':
      case 'signaling_answer':
      case 'signaling_ice':
        this.handleSignaling(player, message);
        break;
    }
  }

  private handleCreateRoom(player: Player, message: CreateRoom): void {
    const roomId = this.generateRoomCode();
    player.name = message.playerName;

    const room: Room = {
      id: roomId,
      hostId: player.id,
      players: new Map([[player.id, player]]),
      totalLaps: message.totalLaps,
      state: 'lobby',
    };

    this.rooms.set(roomId, room);
    player.roomId = roomId;

    this.send(player, {
      type: 'room_created',
      roomId,
      playerId: player.id,
    });

    this.send(player, {
      type: 'room_joined',
      roomId,
      playerId: player.id,
      players: [{ id: player.id, name: player.name, isHost: true, carColor: player.carColor }],
      totalLaps: room.totalLaps,
    });

    console.log(`[Signaling] Room ${roomId} created by ${player.name}`);
  }

  private handleJoinRoom(player: Player, message: JoinRoom): void {
    const room = this.rooms.get(message.roomId);

    if (!room) {
      this.send(player, {
        type: 'error',
        message: 'Room not found',
      });
      return;
    }

    if (room.state !== 'lobby') {
      this.send(player, {
        type: 'error',
        message: 'Race already started',
      });
      return;
    }

    if (room.players.size >= 4) {
      this.send(player, {
        type: 'error',
        message: 'Room is full',
      });
      return;
    }

    player.name = message.playerName;
    player.roomId = room.id;
    room.players.set(player.id, player);

    // Send room info to joining player
    this.send(player, {
      type: 'room_joined',
      roomId: room.id,
      playerId: player.id,
      players: Array.from(room.players.values()).map((p) => ({
        id: p.id,
        name: p.name,
        isHost: p.id === room.hostId,
        carColor: p.carColor,
      })),
      totalLaps: room.totalLaps,
    });

    // Notify all other players
    this.broadcast(
      room,
      {
        type: 'player_joined',
        playerId: player.id,
        playerName: player.name,
        carColor: player.carColor,
      },
      player.id,
    );

    console.log(`[Signaling] ${player.name} joined room ${room.id}`);
  }

  private handleLeaveRoom(player: Player): void {
    if (!player.roomId) return;

    const room = this.rooms.get(player.roomId);
    if (!room) return;

    room.players.delete(player.id);
    player.roomId = null;

    // Notify others
    this.broadcast(room, {
      type: 'player_left',
      playerId: player.id,
    });

    // If host left, close the room
    if (player.id === room.hostId) {
      console.log(`[Signaling] Host left, closing room ${room.id}`);
      this.closeRoom(room);
    } else if (room.players.size === 0) {
      this.rooms.delete(room.id);
      console.log(`[Signaling] Room ${room.id} empty, deleted`);
    }

    console.log(`[Signaling] ${player.name} left room ${room.id}`);
  }

  private handleStartRace(player: Player): void {
    if (!player.roomId) return;

    const room = this.rooms.get(player.roomId);
    if (!room) return;

    if (player.id !== room.hostId) {
      this.send(player, {
        type: 'error',
        message: 'Only host can start race',
      });
      return;
    }

    if (room.players.size < 2) {
      this.send(player, {
        type: 'error',
        message: 'Need at least 2 players',
      });
      return;
    }

    room.state = 'racing';

    // Broadcast race start to all players
    this.broadcast(room, {
      type: 'race_start',
      countdown: 5,
    });

    console.log(`[Signaling] Race started in room ${room.id}`);
  }

  private handleUpdateColor(player: Player, message: { type: 'update_color'; color: number }): void {
    if (!player.roomId) return;

    const room = this.rooms.get(player.roomId);
    if (!room) return;

    // Update player's color
    player.carColor = message.color;

    // Broadcast color change to all other players in the room
    this.broadcast(
      room,
      {
        type: 'player_color_changed',
        playerId: player.id,
        color: message.color,
      },
      player.id,
    );

    console.log(`[Signaling] Player ${player.name} changed color to ${message.color.toString(16)}`);
  }

  private handleSignaling(
    _player: Player,
    message:
      | { type: 'signaling_offer'; targetId: string; offer: RTCSessionDescriptionInit }
      | { type: 'signaling_answer'; targetId: string; answer: RTCSessionDescriptionInit }
      | { type: 'signaling_ice'; targetId: string; candidate: RTCIceCandidateInit },
  ): void {
    const target = this.players.get(message.targetId);
    if (!target) {
      console.warn(`[Signaling] Target player ${message.targetId} not found`);
      return;
    }

    // Forward signaling message to target
    this.send(target, message as SignalingServerMessage);
  }

  private handleDisconnect(player: Player): void {
    console.log(`[Signaling] Player ${player.id} disconnected`);

    if (player.roomId) {
      this.handleLeaveRoom(player);
    }

    this.players.delete(player.id);
  }

  private closeRoom(room: Room): void {
    // Notify all players and disconnect them
    this.broadcast(room, {
      type: 'error',
      message: 'Host disconnected, room closed',
    });

    room.players.forEach((p) => {
      p.roomId = null;
    });

    this.rooms.delete(room.id);
  }

  private send(player: Player, message: SignalingServerMessage): void {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify(message));
    }
  }

  private broadcast(room: Room, message: SignalingServerMessage, excludeId?: string): void {
    room.players.forEach((player) => {
      if (player.id !== excludeId) {
        this.send(player, message);
      }
    });
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }

      if (!this.rooms.has(code)) {
        return code;
      }
      attempts++;
    }

    // Fallback: append timestamp if collision persists
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code + Date.now().toString(36).slice(-2).toUpperCase();
  }
}
