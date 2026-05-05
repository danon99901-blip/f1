// Shared game state types

export interface GameState {
  mode: 'single' | 'multi_host' | 'multi_guest';
  players: Map<string, PlayerState>;
  localPlayerId: string | null;
}

export interface PlayerState {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  velocity: { x: number; y: number; z: number };
  speedKmh: number;
  gear: number | 'N' | 'R';
  currentLap: number;
  lapTimeMs: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
}

export type TrackType = 'default' | 'silverstone' | 'monaco';

export interface RoomInfo {
  roomId: string;
  hostId: string;
  players: { id: string; name: string; isHost: boolean; carColor: number }[];
  totalLaps: number;
  trackType: TrackType;
  state: 'lobby' | 'countdown' | 'racing' | 'finished';
}

export interface InputState {
  throttle: number;  // 0..1
  brake: number;     // 0..1
  steer: number;     // -1..1
}
