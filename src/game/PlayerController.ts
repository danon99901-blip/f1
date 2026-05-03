// Player controller for local player vehicle control

import type { Vehicle } from '../car/vehicle';
import type { Track } from '../track/track';
import type { InputState } from '../shared/types';
import * as THREE from 'three';

export class PlayerController {
  private vehicle: Vehicle;
  private track: Track;
  private spawnPosition: THREE.Vector3;
  private spawnRotation: { x: number; y: number; z: number; w: number };
  private belowTrackTimer = 0;

  constructor(vehicle: Vehicle, track: Track) {
    this.vehicle = vehicle;
    this.track = track;

    const spawn = track.lapInfo.spawn;
    this.spawnPosition = spawn.position.clone();
    const yawSpawn = Math.atan2(-spawn.forward.x, -spawn.forward.z);
    this.spawnRotation = {
      x: 0,
      y: Math.sin(yawSpawn / 2),
      z: 0,
      w: Math.cos(yawSpawn / 2),
    };
  }

  update(input: InputState, dt: number): void {
    // Safety recovery
    const y = this.vehicle.rigidBody.translation().y;
    if (!Number.isFinite(y) || y < -1.2) {
      this.respawn('hard-fall');
    } else if (y < 0.28) {
      this.belowTrackTimer += dt;
      if (this.belowTrackTimer > 0.35) {
        this.respawn('below-track');
      }
    } else {
      this.belowTrackTimer = 0;
    }

    // Apply grip multiplier for off-track
    const onTrack = this.track.isOnTrack(this.vehicle.rigidBody.translation());
    const gripMul = onTrack ? 1 : this.track.lapInfo.offTrackGripMultiplier;

    const drivingInput = {
      throttle: input.throttle * gripMul,
      brake: input.brake,
      steer: input.steer * gripMul,
    };

    this.vehicle.update(drivingInput, dt);
  }

  respawn(reason?: string): void {
    if (reason) {
      console.warn(`[PlayerController] Respawn: ${reason}`);
    }

    this.vehicle.rigidBody.setTranslation(this.spawnPosition, true);
    this.vehicle.rigidBody.setRotation(this.spawnRotation, true);
    this.vehicle.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.vehicle.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.belowTrackTimer = 0;
  }

  getVehicle(): Vehicle {
    return this.vehicle;
  }

  setSpawnPoint(position: THREE.Vector3, forward: THREE.Vector3): void {
    this.spawnPosition = position.clone();
    const yaw = Math.atan2(-forward.x, -forward.z);
    this.spawnRotation = {
      x: 0,
      y: Math.sin(yaw / 2),
      z: 0,
      w: Math.cos(yaw / 2),
    };
  }
}
