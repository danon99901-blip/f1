// Interpolator for smooth remote player movement

import * as THREE from 'three';
import type { PlayerSnapshot } from '../../shared/protocol';
import { SNAPSHOT_BUFFER_SIZE } from '../../shared/constants';

interface Snapshot {
  timestamp: number;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  velocity: THREE.Vector3;
}

export class Interpolator {
  private snapshots: Snapshot[] = [];
  private renderDelay: number;

  constructor(renderDelayMs: number = 100) {
    this.renderDelay = renderDelayMs;
  }

  addSnapshot(snapshot: PlayerSnapshot, serverTimestamp: number): void {
    const newSnapshot = {
      timestamp: serverTimestamp,
      position: new THREE.Vector3(...snapshot.position),
      rotation: new THREE.Quaternion(...snapshot.rotation),
      velocity: new THREE.Vector3(...snapshot.velocity),
    };

    // Insert in sorted order (snapshots usually arrive in order)
    const insertIndex = this.snapshots.findIndex((s) => s.timestamp > serverTimestamp);
    if (insertIndex === -1) {
      this.snapshots.push(newSnapshot);
    } else {
      this.snapshots.splice(insertIndex, 0, newSnapshot);
    }

    // Keep only recent snapshots
    if (this.snapshots.length > SNAPSHOT_BUFFER_SIZE * 2) {
      this.snapshots.shift();
    }
  }

  interpolate(currentTime: number): {
    position: THREE.Vector3;
    rotation: THREE.Quaternion;
  } | null {
    if (this.snapshots.length < 2) {
      // Not enough data, return latest if available
      if (this.snapshots.length === 1) {
        const snap = this.snapshots[0]!;
        return {
          position: snap.position.clone(),
          rotation: snap.rotation.clone(),
        };
      }
      return null;
    }

    // Render time is slightly in the past to allow buffering
    const renderTime = currentTime - this.renderDelay;

    // Find the two snapshots to interpolate between
    let from: Snapshot | null = null;
    let to: Snapshot | null = null;

    for (let i = 0; i < this.snapshots.length - 1; i++) {
      if (
        this.snapshots[i]!.timestamp <= renderTime &&
        this.snapshots[i + 1]!.timestamp >= renderTime
      ) {
        from = this.snapshots[i]!;
        to = this.snapshots[i + 1]!;
        break;
      }
    }

    // If we're ahead of all snapshots, extrapolate from the last two
    if (!from || !to) {
      const len = this.snapshots.length;
      if (len >= 2) {
        from = this.snapshots[len - 2]!;
        to = this.snapshots[len - 1]!;

        // Extrapolate using velocity
        const dt = (renderTime - to.timestamp) / 1000; // Convert to seconds
        if (dt > 0 && dt < 0.2) {
          // Only extrapolate up to 200ms
          const extrapolatedPos = to.position.clone().addScaledVector(to.velocity, dt);
          return {
            position: extrapolatedPos,
            rotation: to.rotation.clone(),
          };
        }

        // Too far ahead, just use latest
        return {
          position: to.position.clone(),
          rotation: to.rotation.clone(),
        };
      }

      return null;
    }

    // Interpolate between from and to
    const totalDelta = to.timestamp - from.timestamp;
    if (totalDelta === 0) {
      return {
        position: to.position.clone(),
        rotation: to.rotation.clone(),
      };
    }

    const t = (renderTime - from.timestamp) / totalDelta;
    const clampedT = Math.max(0, Math.min(1, t));

    // Linear interpolation for position
    const position = new THREE.Vector3().lerpVectors(from.position, to.position, clampedT);

    // Spherical interpolation for rotation (smoother)
    const rotation = new THREE.Quaternion().slerpQuaternions(from.rotation, to.rotation, clampedT);

    // Clean up old snapshots (keep at least 2)
    while (this.snapshots.length > 2 && this.snapshots[0]!.timestamp < renderTime - 1000) {
      this.snapshots.shift();
    }

    return { position, rotation };
  }

  reset(): void {
    this.snapshots = [];
  }

  hasData(): boolean {
    return this.snapshots.length > 0;
  }
}
