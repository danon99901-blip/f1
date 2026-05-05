// Network protocol for P2P multiplayer

// ============================================================================
// Client → Host messages
// ============================================================================

export interface ClientInput {
  type: 'input';
  seq: number;           // Sequence number for client-side prediction
  throttle: number;      // 0..1
  brake: number;         // 0..1
  steer: number;         // -1..1
  timestamp: number;     // Client timestamp (performance.now())
}

export interface ClientReady {
  type: 'ready';
  playerName: string;
}

export interface ClientInitialPosition {
  type: 'initial_position';
  position: [number, number, number];
  rotation: [number, number, number, number]; // quaternion (x, y, z, w)
}

export type ClientMessage = ClientInput | ClientReady | ClientInitialPosition;

// ============================================================================
// Host → Client messages
// ============================================================================

export interface HostSnapshot {
  type: 'snapshot';
  tick: number;          // Server tick number
  timestamp: number;     // Host timestamp
  players: PlayerSnapshot[];
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  carColor: number;
  position: [number, number, number];
  rotation: [number, number, number, number]; // quaternion (x, y, z, w)
  velocity: [number, number, number];
  speedKmh: number;
  gear: number | 'N' | 'R';
  currentLap: number;
  lapTimeMs: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
}

export interface RaceConfig {
  type: 'race_config';
  totalLaps: number;
  trackLength: number;
}

export interface RaceStart {
  type: 'race_start';
  countdown: number;     // Seconds until race starts
}

export interface RaceFinish {
  type: 'race_finish';
  results: {
    id: string;
    name: string;
    position: number;
    totalTime: number;
    bestLap: number | null;
  }[];
}

export interface InitialPosition {
  type: 'initial_position';
  position: [number, number, number];
  rotation: [number, number, number, number]; // quaternion (x, y, z, w)
}

export type HostMessage = HostSnapshot | RaceConfig | RaceStart | RaceFinish | InitialPosition;

// ============================================================================
// Signaling server messages (for room management)
// ============================================================================

export interface CreateRoom {
  type: 'create_room';
  playerName: string;
  totalLaps: number;     // 3, 5, or 10
  trackType: string;     // 'default', 'silverstone', 'monaco'
}

export interface JoinRoom {
  type: 'join_room';
  roomId: string;
  playerName: string;
}

export interface LeaveRoom {
  type: 'leave_room';
}

export interface StartRace {
  type: 'start_race';
}

export interface UpdateColor {
  type: 'update_color';
  color: number;
}

export interface UpdateRoomSettings {
  type: 'update_room_settings';
  totalLaps?: number;
  trackType?: string;
}

export interface RoomSettingsChanged {
  type: 'room_settings_changed';
  totalLaps?: number;
  trackType?: string;
}

export interface PlayerColorChanged {
  type: 'player_color_changed';
  playerId: string;
  color: number;
}

export interface RoomCreated {
  type: 'room_created';
  roomId: string;
  playerId: string;
}

export interface RoomJoined {
  type: 'room_joined';
  roomId: string;
  playerId: string;
  players: { id: string; name: string; isHost: boolean; carColor: number }[];
  totalLaps: number;
  trackType: string;
}

export interface PlayerJoined {
  type: 'player_joined';
  playerId: string;
  playerName: string;
  carColor: number;
}

export interface PlayerLeft {
  type: 'player_left';
  playerId: string;
}

export interface RoomError {
  type: 'error';
  message: string;
}

export interface SignalingOffer {
  type: 'signaling_offer';
  targetId: string;
  offer: RTCSessionDescriptionInit;
}

export interface SignalingAnswer {
  type: 'signaling_answer';
  targetId: string;
  answer: RTCSessionDescriptionInit;
}

export interface SignalingIceCandidate {
  type: 'signaling_ice';
  targetId: string;
  candidate: RTCIceCandidateInit;
}

export type SignalingClientMessage =
  | CreateRoom
  | JoinRoom
  | LeaveRoom
  | StartRace
  | UpdateColor
  | UpdateRoomSettings
  | SignalingOffer
  | SignalingAnswer
  | SignalingIceCandidate;

export type SignalingServerMessage =
  | RoomCreated
  | RoomJoined
  | PlayerJoined
  | PlayerLeft
  | PlayerColorChanged
  | RoomSettingsChanged
  | RoomError
  | SignalingOffer
  | SignalingAnswer
  | SignalingIceCandidate
  | RaceStart;
