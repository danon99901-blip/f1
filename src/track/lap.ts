import type RAPIER from '@dimforge/rapier3d-compat';
import type { Track } from './track';

export interface LapTrackerState {
  /** Current lap number; starts at 0 (warm-up before first crossing). */
  currentLap: number;
  /** Last completed lap time in seconds (NaN if no lap completed yet). */
  lastLapTime: number;
  /** Best lap time in seconds (NaN if no lap completed yet). */
  bestLapTime: number;
  /** Live, in-flight lap timer in seconds. */
  currentLapTime: number;
  /** Normalised position along the track in [0, 1). */
  position: number;
  /** Index of the checkpoint we expect to hit next. */
  nextCheckpointIndex: number;
}

export interface LapTracker {
  state: LapTrackerState;
  /** Call once per simulation step. dt in seconds. */
  update: (dt: number) => void;
  /** Reset everything (e.g. after a respawn). */
  reset: () => void;
}

/**
 * State machine:
 *  - We expect checkpoints to fire in strictly increasing order modulo N.
 *  - Hitting checkpoint 0 (the start/finish line) AFTER having visited every
 *    other checkpoint completes a lap.
 *  - Hitting an out-of-order checkpoint is ignored (prevents shortcuts).
 *  - Hitting the same checkpoint repeatedly (we're standing on it) is ignored
 *    after the first trigger by tracking lastTriggeredIndex.
 *
 * We poll `world.intersectionPairsWith(checkpointCollider, ...)` once per
 * frame for each checkpoint and check whether any of the car body's colliders
 * is currently overlapping it. This avoids needing an EventQueue and is
 * simpler than narrow-phase collision-event handling.
 */
export function createLapTracker(
  track: Track,
  carBody: RAPIER.RigidBody,
  world: RAPIER.World,
): LapTracker {
  const state: LapTrackerState = {
    currentLap: 0,
    lastLapTime: NaN,
    bestLapTime: NaN,
    currentLapTime: 0,
    position: 0,
    nextCheckpointIndex: 1, // we start before the line, expect to hit 1 next
  };

  // Track which checkpoints have been visited in this lap (excluding 0).
  const visited = new Set<number>();
  // Set of checkpoints currently overlapped by the car (to detect "enter").
  let prevOverlap = new Set<number>();
  let lapStarted = false;
  let lastTriggeredIndex = -1;

  // Build a Set of car-collider handles for fast membership tests.
  const carColliderHandles = new Set<number>();
  for (let i = 0; i < carBody.numColliders(); i++) {
    carColliderHandles.add(carBody.collider(i).handle);
  }

  const reset = () => {
    state.currentLap = 0;
    state.lastLapTime = NaN;
    state.bestLapTime = NaN;
    state.currentLapTime = 0;
    state.position = 0;
    state.nextCheckpointIndex = 1;
    visited.clear();
    prevOverlap = new Set();
    lapStarted = false;
    lastTriggeredIndex = -1;
  };

  const update = (dt: number) => {
    // 1. Poll overlaps for each checkpoint sensor.
    const currentOverlap = new Set<number>();
    for (const cp of track.checkpoints) {
      let touching = false;
      world.intersectionPairsWith(cp.collider, (other) => {
        if (carColliderHandles.has(other.handle)) {
          touching = true;
        }
      });
      if (touching) currentOverlap.add(cp.index);
    }

    // 2. For each checkpoint that the car ENTERED this frame (i.e. is now
    // overlapping but wasn't last frame), advance the state machine.
    for (const idx of currentOverlap) {
      if (prevOverlap.has(idx)) continue;
      if (idx === lastTriggeredIndex) continue;
      handleCheckpointEntered(idx);
      lastTriggeredIndex = idx;
    }
    prevOverlap = currentOverlap;

    // 3. Tick the live lap timer.
    if (lapStarted) {
      state.currentLapTime += dt;
    }

    // 4. Update progress from car position (cheap and useful for HUD).
    const t = carBody.translation();
    state.position = track.getProgress(t);
  };

  function handleCheckpointEntered(idx: number) {
    if (idx === 0) {
      // Start/finish line.
      if (!lapStarted) {
        // First crossing — begin lap 1.
        lapStarted = true;
        state.currentLap = 1;
        state.currentLapTime = 0;
        visited.clear();
        state.nextCheckpointIndex = 1;
        return;
      }
      // To complete a lap we must have visited every other checkpoint.
      const checkpointCount = track.checkpoints.length;
      let allVisited = true;
      for (let i = 1; i < checkpointCount; i++) {
        if (!visited.has(i)) {
          allVisited = false;
          break;
        }
      }
      if (allVisited) {
        const lapTime = state.currentLapTime;
        state.lastLapTime = lapTime;
        if (Number.isNaN(state.bestLapTime) || lapTime < state.bestLapTime) {
          state.bestLapTime = lapTime;
        }
        state.currentLap += 1;
        state.currentLapTime = 0;
        visited.clear();
        state.nextCheckpointIndex = 1;
      }
      // Otherwise ignore — driver crossed the line without doing the loop.
      return;
    }

    // Non-zero checkpoint. Only count if it's the one we expected.
    if (idx === state.nextCheckpointIndex) {
      visited.add(idx);
      state.nextCheckpointIndex = (idx + 1) % track.checkpoints.length;
    }
    // Out-of-order or repeated: ignore (prevents shortcuts and reverse laps).
  }

  return { state, update, reset };
}
