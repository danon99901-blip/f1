// Opponent controller managing AI or remote players

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { createOpponents, type OpponentsController } from '../ai/opponents';
import { Interpolator } from '../client/game/Interpolator';
import { PlayerNameTag } from '../client/game/PlayerNameTag';
import type { PlayerSnapshot } from '../shared/protocol';
import { createCarModel } from '../car/vehicle';

export type OpponentMode = 'ai' | 'remote';

interface RemoteOpponent {
  id: string;
  name: string;
  mesh: THREE.Group;
  interpolator: Interpolator;
  nameTag: PlayerNameTag;
}

export class OpponentController {
  private mode: OpponentMode;
  private aiController: OpponentsController | null = null;
  private remoteOpponents = new Map<string, RemoteOpponent>();
  private scene: THREE.Scene;

  constructor(mode: OpponentMode, scene: THREE.Scene) {
    this.mode = mode;
    this.scene = scene;
  }

  initAI(
    world: RAPIER.World,
    trackLength: number,
    playerStartProgress: number,
    count: number
  ): void {
    if (this.mode !== 'ai') {
      throw new Error('OpponentController not in AI mode');
    }
    this.aiController = createOpponents(this.scene, world, trackLength, playerStartProgress, count);
  }

  updateAI(dt: number, elapsedTime: number, playerSpeedKmh: number, playerBody: RAPIER.RigidBody): void {
    if (this.aiController) {
      this.aiController.update(dt, elapsedTime, playerSpeedKmh);
      this.aiController.handlePlayerImpacts(playerBody);
    }
  }

  addRemotePlayer(id: string, name: string, carColor: number, isLocalPlayer: boolean): void {
    if (this.mode !== 'remote') {
      throw new Error('OpponentController not in remote mode');
    }

    if (this.remoteOpponents.has(id)) {
      console.warn(`[OpponentController] Remote player ${id} already exists, skipping`);
      return;
    }

    console.log(`[OpponentController] Creating remote player ${id} (${name}) with color 0x${carColor.toString(16)}`);
    const mesh = createCarModel(carColor);
    this.scene.add(mesh);
    console.log(`[OpponentController] Mesh added to scene at position:`, mesh.position);

    const nameTag = new PlayerNameTag(
      name,
      isLocalPlayer ? '#00ff00' : '#ffffff'
    );
    nameTag.addToScene(this.scene);

    // Use default interpolation delay (will be updated by adaptive config)
    this.remoteOpponents.set(id, {
      id,
      name,
      mesh,
      interpolator: new Interpolator(100),
      nameTag,
    });
    console.log(`[OpponentController] Remote player ${id} added successfully. Total opponents: ${this.remoteOpponents.size}`);
  }

  /**
   * Update interpolation delay for all remote players based on network conditions
   */
  updateInterpolationDelay(delayMs: number): void {
    this.remoteOpponents.forEach((opponent) => {
      opponent.interpolator = new Interpolator(delayMs);
    });
  }

  removeRemotePlayer(id: string): void {
    const opponent = this.remoteOpponents.get(id);
    if (opponent) {
      // Remove mesh from scene
      this.scene.remove(opponent.mesh);

      // Dispose name tag
      opponent.nameTag.dispose();

      // Reset interpolator
      opponent.interpolator.reset();

      // Dispose geometries and materials
      opponent.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach((mat) => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });

      // Remove from map
      this.remoteOpponents.delete(id);
      console.log(`[OpponentController] Removed remote player ${id}`);
    }
  }

  updateRemotePlayer(snapshot: PlayerSnapshot, timestamp: number): void {
    const opponent = this.remoteOpponents.get(snapshot.id);
    if (opponent) {
      opponent.interpolator.addSnapshot(snapshot, timestamp);
    } else {
      console.warn(`[OpponentController] Received snapshot for unknown player ${snapshot.id}`);
    }
  }

  setInitialPosition(id: string, position: THREE.Vector3, rotation: THREE.Quaternion): void {
    const opponent = this.remoteOpponents.get(id);
    if (opponent) {
      opponent.mesh.position.copy(position);
      opponent.mesh.quaternion.copy(rotation);
      opponent.nameTag.updatePosition(position);
    }
  }

  /**
   * Update remote player position directly without interpolation.
   * Used by the host to update guest visual meshes based on their physics bodies.
   */
  updateRemotePlayerDirect(id: string, position: THREE.Vector3, rotation: THREE.Quaternion): void {
    const opponent = this.remoteOpponents.get(id);
    if (opponent) {
      opponent.mesh.position.copy(position);
      opponent.mesh.quaternion.copy(rotation);
      opponent.nameTag.updatePosition(position);
    }
  }

  updateRemoteVisuals(currentTime: number): THREE.Group | null {
    let localPlayerMesh: THREE.Group | null = null;
    let updatedCount = 0;

    this.remoteOpponents.forEach((opponent) => {
      const interpolated = opponent.interpolator.interpolate(currentTime);
      if (interpolated) {
        opponent.mesh.position.copy(interpolated.position);
        opponent.mesh.quaternion.copy(interpolated.rotation);
        opponent.nameTag.updatePosition(interpolated.position);
        updatedCount++;
      } else {
        // Log when interpolation fails
        if (!opponent.interpolator.hasData()) {
          console.warn(`[OpponentController] No interpolation data for ${opponent.id} (${opponent.name})`);
        }
      }
    });

    if (updatedCount === 0 && this.remoteOpponents.size > 0) {
      console.warn(`[OpponentController] No opponents updated. Total opponents: ${this.remoteOpponents.size}`);
    }

    return localPlayerMesh;
  }

  getAIPlayerPosition(playerArcDistance: number): number {
    if (this.aiController) {
      return this.aiController.getPlayerPosition(playerArcDistance);
    }
    return 1;
  }

  getTotalCars(): number {
    if (this.aiController) {
      return this.aiController.getTotalCars();
    }
    return this.remoteOpponents.size;
  }

  getRemotePlayerMesh(playerId: string): THREE.Group | null {
    return this.remoteOpponents.get(playerId)?.mesh ?? null;
  }

  dispose(): void {
    this.remoteOpponents.forEach((opponent) => {
      this.scene.remove(opponent.mesh);
      opponent.nameTag.dispose();
      opponent.interpolator.reset();
      // Dispose geometries and materials
      opponent.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach((mat) => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });
    });
    this.remoteOpponents.clear();

    // Clean up AI controller
    if (this.aiController) {
      this.aiController.dispose();
      this.aiController = null;
    }
  }
}
