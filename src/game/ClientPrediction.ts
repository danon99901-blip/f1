// Client-side prediction system for smooth multiplayer movement

import type { InputState } from '../shared/types';
import type { PlayerController } from './PlayerController';
import type { PlayerSnapshot } from '../shared/protocol';
import * as THREE from 'three';

interface InputHistoryEntry {
  seq: number;
  input: InputState;
  timestamp: number;
}

export class ClientPrediction {
  private inputHistory: InputHistoryEntry[] = [];
  private maxHistorySize = 60; // 3 seconds at 20 Hz
  private reconciliationThreshold = 0.5; // 0.5 meters
  private lastServerSnapshot: PlayerSnapshot | null = null;
  private lastReconciliationTime = 0;
  private reconciliationCooldown = 100; // ms

  constructor(private controller: PlayerController) {}

  /**
   * Record input for client-side prediction
   */
  recordInput(seq: number, input: InputState, timestamp: number): void {
    this.inputHistory.push({ seq, input, timestamp });

    // Keep history size bounded
    if (this.inputHistory.length > this.maxHistorySize) {
      this.inputHistory.shift();
    }
  }

  /**
   * Handle server snapshot and reconcile if needed
   */
  reconcile(snapshot: PlayerSnapshot, serverTimestamp: number): boolean {
    this.lastServerSnapshot = snapshot;

    const currentTime = performance.now();

    // Don't reconcile too frequently
    if (currentTime - this.lastReconciliationTime < this.reconciliationCooldown) {
      return false;
    }

    const vehicle = this.controller.getVehicle();
    const clientPos = vehicle.rigidBody.translation();
    const serverPos = new THREE.Vector3(
      snapshot.position[0],
      snapshot.position[1],
      snapshot.position[2]
    );

    // Calculate position error using THREE.Vector3
    const clientPosVec = new THREE.Vector3(clientPos.x, clientPos.y, clientPos.z);
    const error = clientPosVec.distanceTo(serverPos);

    // If error is above threshold, reconcile
    if (error > this.reconciliationThreshold) {
      this.performReconciliation(snapshot, serverTimestamp);
      this.lastReconciliationTime = currentTime;
      return true;
    }

    return false;
  }

  /**
   * Perform server reconciliation by rewinding and replaying inputs
   */
  private performReconciliation(snapshot: PlayerSnapshot, serverTimestamp: number): void {
    const vehicle = this.controller.getVehicle();

    // Step 1: Rewind to server state
    vehicle.rigidBody.setTranslation(
      {
        x: snapshot.position[0],
        y: snapshot.position[1],
        z: snapshot.position[2],
      },
      true
    );

    vehicle.rigidBody.setRotation(
      {
        x: snapshot.rotation[0],
        y: snapshot.rotation[1],
        z: snapshot.rotation[2],
        w: snapshot.rotation[3],
      },
      true
    );

    vehicle.rigidBody.setLinvel(
      {
        x: snapshot.velocity[0],
        y: snapshot.velocity[1],
        z: snapshot.velocity[2],
      },
      true
    );

    // Step 2: Find inputs that happened after this snapshot (using correct timestamp comparison)
    const unprocessedInputs = this.inputHistory.filter(
      (entry) => entry.timestamp > serverTimestamp
    );

    // Step 3: Replay unprocessed inputs
    if (unprocessedInputs.length > 0) {
      // Estimate dt between inputs (typically 50ms at 20 Hz)
      const avgDt = 0.05;

      for (const entry of unprocessedInputs) {
        this.controller.update(entry.input, avgDt);
      }
    }

    // Sync visuals after reconciliation
    vehicle.syncVisuals();
  }

  /**
   * Clear old inputs that server has definitely processed
   */
  clearOldInputs(serverTimestamp: number): void {
    // Keep inputs from last 1 second
    const cutoffTime = serverTimestamp - 1000;
    this.inputHistory = this.inputHistory.filter(
      (entry) => entry.timestamp > cutoffTime
    );
  }

  /**
   * Get current prediction state for debugging
   */
  getState(): {
    historySize: number;
    lastError: number | null;
    lastReconciliation: number;
  } {
    let lastError: number | null = null;

    if (this.lastServerSnapshot) {
      const vehicle = this.controller.getVehicle();
      const clientPos = vehicle.rigidBody.translation();
      const clientPosVec = new THREE.Vector3(clientPos.x, clientPos.y, clientPos.z);
      const serverPos = new THREE.Vector3(
        this.lastServerSnapshot.position[0],
        this.lastServerSnapshot.position[1],
        this.lastServerSnapshot.position[2]
      );
      lastError = clientPosVec.distanceTo(serverPos);
    }

    return {
      historySize: this.inputHistory.length,
      lastError,
      lastReconciliation: this.lastReconciliationTime,
    };
  }

  /**
   * Reset prediction state
   */
  reset(): void {
    this.inputHistory = [];
    this.lastServerSnapshot = null;
    this.lastReconciliationTime = 0;
  }
}
