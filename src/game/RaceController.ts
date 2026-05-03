// Race controller managing race state, lap tracking, and positions

import type { EventBus } from '../core/EventBus';
import type { Track } from '../track/track';
import { createLapTracker } from '../track/lap';
import type RAPIER from '@dimforge/rapier3d-compat';

export interface RacePlayer {
  id: string;
  name: string;
  rigidBody: RAPIER.RigidBody;
  lapTracker: ReturnType<typeof createLapTracker>;
  arcDistance: number;
  finished: boolean;
  finishTime: number | null;
  position: number;
  previousLap: number;
}

export interface RaceResult {
  id: string;
  name: string;
  position: number;
  totalTime: number;
  bestLap: number | null;
}

export class RaceController {
  private players = new Map<string, RacePlayer>();
  private totalLaps: number;
  private track: Track;
  private world: RAPIER.World;
  private eventBus: EventBus;
  private raceStartTime = 0;
  private finishedCount = 0;

  constructor(
    totalLaps: number,
    track: Track,
    world: RAPIER.World,
    eventBus: EventBus
  ) {
    this.totalLaps = totalLaps;
    this.track = track;
    this.world = world;
    this.eventBus = eventBus;
  }

  addPlayer(id: string, name: string, rigidBody: RAPIER.RigidBody): void {
    const lapTracker = createLapTracker(this.track, rigidBody, this.world);
    const startPos = rigidBody.translation();
    const startProgress = this.track.getProgress(startPos);

    this.players.set(id, {
      id,
      name,
      rigidBody,
      lapTracker,
      arcDistance: startProgress * this.track.lapInfo.length,
      finished: false,
      finishTime: null,
      position: 0,
      previousLap: 1,
    });
  }

  start(): void {
    this.raceStartTime = performance.now();
    this.eventBus.emit('race:start', undefined);
  }

  update(dt: number): void {
    this.players.forEach((player) => {
      if (player.finished) return;

      // Update lap tracker
      player.lapTracker.update(dt);

      // Update arc distance
      const vel = player.rigidBody.linvel();
      const forward = player.rigidBody.rotation();
      const forwardVec = { x: 0, y: 0, z: -1 };
      const rotatedForward = {
        x:
          forwardVec.x * (1 - 2 * (forward.y * forward.y + forward.z * forward.z)) +
          forwardVec.y * 2 * (forward.x * forward.y - forward.w * forward.z) +
          forwardVec.z * 2 * (forward.x * forward.z + forward.w * forward.y),
        y:
          forwardVec.x * 2 * (forward.x * forward.y + forward.w * forward.z) +
          forwardVec.y * (1 - 2 * (forward.x * forward.x + forward.z * forward.z)) +
          forwardVec.z * 2 * (forward.y * forward.z - forward.w * forward.x),
        z:
          forwardVec.x * 2 * (forward.x * forward.z - forward.w * forward.y) +
          forwardVec.y * 2 * (forward.y * forward.z + forward.w * forward.x) +
          forwardVec.z * (1 - 2 * (forward.x * forward.x + forward.y * forward.y)),
      };
      const forwardSpeed = vel.x * rotatedForward.x + vel.z * rotatedForward.z;
      player.arcDistance += forwardSpeed * dt;

      // Check lap completion
      const lapState = player.lapTracker.state;
      if (lapState.currentLap > player.previousLap) {
        this.eventBus.emit('race:lap-complete', {
          playerId: player.id,
          lapNumber: player.previousLap,
          lapTime: lapState.lastLapTime * 1000,
        });
        player.previousLap = lapState.currentLap;
      }

      // Check race finish
      if (lapState.currentLap > this.totalLaps && !player.finished) {
        player.finished = true;
        player.finishTime = (performance.now() - this.raceStartTime) / 1000;
        this.finishedCount++;

        this.eventBus.emit('race:finish', {
          playerId: player.id,
          position: this.finishedCount,
          totalTime: player.finishTime,
        });

        if (this.finishedCount === this.players.size) {
          this.eventBus.emit('race:all-finished', undefined);
        }
      }
    });

    // Update positions
    this.updatePositions();
  }

  private updatePositions(): void {
    const sorted = Array.from(this.players.values()).sort(
      (a, b) => b.arcDistance - a.arcDistance
    );

    sorted.forEach((player, index) => {
      player.position = index + 1;
    });
  }

  getPlayerPosition(playerId: string): number {
    return this.players.get(playerId)?.position ?? 0;
  }

  getPlayerLapState(playerId: string) {
    const player = this.players.get(playerId);
    if (!player) {
      return {
        currentLap: 0,
        lastLapTime: NaN,
        bestLapTime: NaN,
        currentLapTime: 0,
        position: 0,
        nextCheckpointIndex: 0,
      };
    }
    return player.lapTracker.state;
  }

  getResults(): RaceResult[] {
    const results: RaceResult[] = [];

    this.players.forEach((player) => {
      results.push({
        id: player.id,
        name: player.name,
        position: player.position,
        totalTime: player.finishTime ?? 0,
        bestLap: player.lapTracker.state.bestLapTime * 1000,
      });
    });

    return results.sort((a, b) => a.position - b.position);
  }

  getTotalCars(): number {
    return this.players.size;
  }

  dispose(): void {
    // Clean up lap trackers first
    this.players.forEach((player) => {
      if (player.lapTracker && typeof player.lapTracker.dispose === 'function') {
        player.lapTracker.dispose();
      }
    });
    this.players.clear();
  }
}
