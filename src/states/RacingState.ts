// Racing state - active race gameplay

import type { GameState, StateContext } from '../core/GameStateMachine';
import type { PhysicsService } from '../services/PhysicsService';
import type { RenderService } from '../services/RenderService';
import type { InputService } from '../services/InputService';
import type { NetworkService } from '../services/NetworkService';
import { RaceController } from '../game/RaceController';
import { PlayerController } from '../game/PlayerController';
import { OpponentController } from '../game/OpponentController';
import { ClientPrediction } from '../game/ClientPrediction';
import { createTrack } from '../track/track';
import { createGround } from '../scene';
import { createHud, type Gear } from '../hud/hud';
import { expDecayBlend } from '../utils/math';
import type { RoomInfo, InputState } from '../shared/types';
import * as THREE from 'three';

function estimateGear(forwardSpeedKmh: number, throttle: number, brake: number): Gear {
  const abs = Math.abs(forwardSpeedKmh);
  if (abs < 1 && throttle === 0 && brake === 0) return 'N';
  if (forwardSpeedKmh < -1) return 'R';
  return Math.max(1, Math.min(8, Math.floor(abs / 40) + 1));
}

export class RacingState implements GameState {
  readonly name = 'racing';
  private context: StateContext | null = null;
  private physicsService: PhysicsService | null = null;
  private renderService: RenderService | null = null;
  private inputService: InputService | null = null;
  private networkService: NetworkService | null = null;
  private raceController: RaceController | null = null;
  private playerController: PlayerController | null = null;
  private opponentController: OpponentController | null = null;
  private hud: ReturnType<typeof createHud> | null = null;
  private cameraTarget = new THREE.Vector3();
  private cameraOffset = new THREE.Vector3(0, 4, 10);
  private totalLaps = 10;
  private gameMode: 'single' | 'multi_host' | 'multi_guest' = 'single';
  private playerArcDistance = 0;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  // Multiplayer state
  private playerId: string | null = null;
  private roomInfo: RoomInfo | null = null;
  private hostTick = 0;
  private lastSnapshotTime = 0;
  private snapshotInterval = 50; // 20 Hz (50ms between snapshots)

  // Guest input state
  private inputSeq = 0;
  private lastInputSendTime = 0;
  private inputSendInterval = 50; // 20 Hz (50ms between input packets)
  private clientPrediction: ClientPrediction | null = null;

  // Host: guest vehicle simulation
  private guestVehicles = new Map<string, {
    vehicle: any; // Vehicle from PhysicsService
    lastInput: { throttle: number; brake: number; steer: number };
    controller: PlayerController;
  }>();

  // Track Three.js objects for cleanup
  private trackMesh: THREE.Group | null = null;
  private track: ReturnType<typeof createTrack> | null = null;
  private groundMesh: THREE.Mesh | null = null;
  private groundGrid: THREE.GridHelper | null = null;
  private vehicleMeshes: THREE.Object3D[] = [];

  // Flag to track opponent initialization in multiplayer
  private opponentInitialized = false;

  // Buffer for snapshots that arrive before OpponentController is created
  private pendingSnapshots: Array<{ snapshot: any; timestamp: number }> = [];

  // Store local player's final spawn position (after offset) for opponent positioning
  private localPlayerSpawnPos: THREE.Vector3 | null = null;

  async enter(context: StateContext): Promise<void> {
    console.log('[RacingState] Enter started');
    this.context = context;
    this.gameMode = (context.data?.gameMode as any) ?? 'single';
    this.totalLaps = context.data?.totalLaps ?? 10;

    console.log('[RacingState] Resolving services...');
    // Resolve services
    const container = context.data?.serviceContainer;
    if (!container) throw new Error('ServiceContainer not provided');

    this.physicsService = await container.resolve('physics') as PhysicsService;
    console.log('[RacingState] Physics resolved');

    this.renderService = await container.resolve('render') as RenderService;
    console.log('[RacingState] Render resolved');

    this.inputService = await container.resolve('input') as InputService;
    console.log('[RacingState] Input resolved');

    // Resolve network service for multiplayer
    if (this.gameMode !== 'single') {
      this.networkService = await container.resolve('network') as NetworkService;
      this.playerId = context.data?.playerId ?? null;
      this.roomInfo = context.data?.roomInfo ?? null;
      console.log('[RacingState] Network resolved, playerId:', this.playerId, 'mode:', this.gameMode);
    }

    // STEP 2: Defensive cleanup - ensure no leftover vehicles from previous failed transitions
    console.log('[RacingState] Performing defensive cleanup of any existing vehicles...');
    const existingLocalVehicle = this.physicsService!.getVehicle('local');
    if (existingLocalVehicle) {
      console.warn('[RacingState] Found existing local vehicle from previous failed transition, destroying it');
      this.physicsService!.destroyVehicle('local');
    }

    // Also clean up any guest vehicles that might be leftover (multiplayer)
    if (this.gameMode === 'multi_host' && this.roomInfo) {
      this.roomInfo.players.forEach(player => {
        if (player.id !== this.playerId) {
          const existingGuestVehicle = this.physicsService!.getVehicle(player.id);
          if (existingGuestVehicle) {
            console.warn(`[RacingState] Found existing guest vehicle ${player.id} from previous failed transition, destroying it`);
            this.physicsService!.destroyVehicle(player.id);
          }
        }
      });
    }
    console.log('[RacingState] Defensive cleanup complete');

    console.log('[RacingState] Creating scene...');
    // Setup scene
    const scene = this.renderService!.getScene();
    const ground = createGround(scene);
    this.groundMesh = ground.mesh;
    this.groundGrid = ground.grid;

    console.log('[RacingState] Creating track...');
    const track = createTrack(this.physicsService!.getWorld(), scene);
    this.track = track;
    this.trackMesh = track.mesh;
    const spawn = track.lapInfo.spawn;
    const yawSpawn = Math.atan2(-spawn.forward.x, -spawn.forward.z);

    console.log('[RacingState] Creating race controller...');
    // Create race controller
    this.raceController = new RaceController(
      this.totalLaps,
      track,
      this.physicsService!.getWorld(),
      context.eventBus
    );

    console.log('[RacingState] Creating vehicle...');

    // Create local player with color from roomInfo
    const localPlayerColor = this.gameMode !== 'single' && this.roomInfo
      ? this.roomInfo.players.find(p => p.id === this.playerId)?.carColor
      : undefined;
    const localVehicle = this.physicsService!.createVehicle('local', scene, localPlayerColor);
    // Track vehicle meshes for cleanup
    this.vehicleMeshes.push(localVehicle.chassisMesh);
    this.vehicleMeshes.push(...localVehicle.wheelMeshes);

    console.log('[RacingState] Spawn position:', spawn.position, 'yaw:', yawSpawn);

    // Apply spawn offset for multiplayer (host left, guest right)
    const spawnPos = spawn.position.clone();
    if (this.gameMode === 'multi_host') {
      spawnPos.x -= 1.5; // Host spawns on left
    } else if (this.gameMode === 'multi_guest') {
      spawnPos.x += 1.5; // Guest spawns on right
    }

    // Store final spawn position for opponent positioning
    this.localPlayerSpawnPos = spawnPos.clone();

    localVehicle.rigidBody.setTranslation(spawnPos, true);
    localVehicle.rigidBody.setRotation(
      { x: 0, y: Math.sin(yawSpawn / 2), z: 0, w: Math.cos(yawSpawn / 2) },
      true
    );

    console.log('[RacingState] Mesh position BEFORE syncVisuals:', localVehicle.chassisMesh.position);
    // Sync visuals immediately so camera can use correct position
    localVehicle.syncVisuals();
    console.log('[RacingState] Mesh position AFTER syncVisuals:', localVehicle.chassisMesh.position);

    this.playerController = new PlayerController(localVehicle, track);
    this.raceController.addPlayer('local', 'Player', localVehicle.rigidBody);

    // Initialize client-side prediction for guest
    if (this.gameMode === 'multi_guest') {
      this.clientPrediction = new ClientPrediction(this.playerController);
      console.log('[RacingState] Client-side prediction enabled for guest');
    }

    const playerStartProgress = track.getProgress(spawn.position);
    this.playerArcDistance = playerStartProgress * track.lapInfo.length;

    console.log('[RacingState] Setting initial camera position...');
    // Set initial camera position to follow the car
    const camera = this.renderService!.getCamera();
    const carPos = localVehicle.chassisMesh.position;

    // Apply camera offset in world space, accounting for car rotation
    const offsetWorld = this.cameraOffset
      .clone()
      .applyQuaternion(localVehicle.chassisMesh.quaternion);

    camera.position.copy(carPos.clone().add(offsetWorld));
    camera.lookAt(carPos);
    console.log('[RacingState] Camera position:', camera.position, 'looking at:', carPos);
    console.log('[RacingState] Scene children count:', scene.children.length);
    console.log('[RacingState] Scene children:', scene.children.map(c => c.type));

    console.log('[RacingState] Setting up opponents...');
    // Setup opponents
    if (this.gameMode === 'single') {
      this.opponentController = new OpponentController('ai', scene);
      this.opponentController.initAI(
        this.physicsService!.getWorld(),
        track.lapInfo.length,
        playerStartProgress,
        5
      );
    } else {
      // Multiplayer: no AI opponents, only remote players
      this.opponentController = new OpponentController('remote', scene);
      // Opponent initialization will happen in update() after first physics step

      // Apply any buffered snapshots that arrived before OpponentController was created
      this.flushPendingSnapshots();
    }

    console.log('[RacingState] Creating HUD...');
    // Setup HUD
    this.hud = createHud();
    document.body.appendChild(this.hud.root);

    console.log('[RacingState] Enabling input...');
    // Enable input
    this.inputService!.enable();

    console.log('[RacingState] Starting race...');
    // Start race
    this.raceController.start();

    // Listen for race finish
    context.eventBus.on('race:all-finished', this.handleRaceFinished);

    // Listen for player color changes in multiplayer
    if (this.gameMode !== 'single') {
      context.eventBus.on('network:player-color-changed', this.handlePlayerColorChanged);
    }

    // Setup multiplayer event listeners
    if (this.gameMode !== 'single' && this.networkService) {
      this.setupMultiplayerListeners();

      // Phase 1: Host sends race config to guests
      if (this.gameMode === 'multi_host') {
        this.sendRaceConfig(track.lapInfo.length);
        // Send initial position to guests
        this.sendInitialPosition();

        // Send again after a short delay to ensure it arrives
        setTimeout(() => {
          this.sendInitialPosition();
          console.log('[RacingState] Host sent delayed initial_position for reliability');
        }, 100);
      }
      // Guest will send initial position after receiving race_config
    }

    // Setup ESC key to pause
    this.onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        this.handlePause();
      }
    };
    window.addEventListener('keydown', this.onKeyDown);

    console.log('[RacingState] Enter complete!');
  }

  update(dt: number): void {
    if (!this.physicsService || !this.renderService || !this.inputService) return;
    if (!this.playerController || !this.raceController) return;

    // Get input
    const input = this.inputService.getInput();

    // Update player
    this.playerController.update(input, dt);
    const vehicle = this.playerController.getVehicle();
    const forwardSpeedKmh = vehicle.getForwardSpeedKmh();
    this.playerArcDistance += (forwardSpeedKmh / 3.6) * dt;

    // Initialize opponents in multiplayer after first physics update
    if (!this.opponentInitialized && this.gameMode !== 'single' && this.opponentController) {
      this.initializeMultiplayerOpponents();
      this.opponentInitialized = true;
    }

    // Update opponents
    if (this.opponentController && this.gameMode === 'single') {
      this.opponentController.updateAI(dt, 0, vehicle.getSpeedKmh(), vehicle.rigidBody);
    }

    // Update guest vehicles (Host only)
    if (this.gameMode === 'multi_host') {
      this.updateGuestVehicles(dt);
    }

    // Update physics
    this.physicsService.step(dt);

    // Update race controller
    this.raceController.update(dt);

    // Multiplayer: Host broadcasts snapshots
    if (this.gameMode === 'multi_host' && this.networkService) {
      this.updateHostBroadcast(dt);
    }

    // Multiplayer: Guest sends input to Host
    if (this.gameMode === 'multi_guest' && this.networkService) {
      this.sendGuestInput(input, dt);
    }

    // Multiplayer: Guest receives and interpolates
    if (this.gameMode === 'multi_guest' && this.opponentController) {
      this.opponentController.updateRemoteVisuals(performance.now());
    }

    // Multiplayer: Host updates guest visual meshes
    if (this.gameMode === 'multi_host') {
      this.updateGuestVisuals();
    }

    // Update camera with frame-rate independent smoothing
    this.cameraTarget.copy(vehicle.chassisMesh.position);
    const offsetWorld = this.cameraOffset
      .clone()
      .applyQuaternion(vehicle.chassisMesh.quaternion);
    const camera = this.renderService.getCamera();
    const cameraBlend = expDecayBlend(5.0, dt);
    camera.position.lerp(this.cameraTarget.clone().add(offsetWorld), cameraBlend);
    camera.lookAt(this.cameraTarget);

    // Update HUD
    if (this.hud) {
      const position = this.raceController.getPlayerPosition('local');
      const totalCars = this.raceController.getTotalCars();
      const lapState = this.raceController.getPlayerLapState('local');

      // Get network stats for multiplayer
      let networkStats = null;
      if (this.gameMode !== 'single' && this.networkService) {
        const stats = this.networkService.getNetworkStats();
        if (stats) {
          // Determine connection state
          let connectionState: 'connected' | 'connecting' | 'disconnected' = 'connected';
          const client = this.networkService.getClient();
          if (client) {
            // Check if we have active data channels
            const dataChannels = (client as any).dataChannels;
            const hasActiveChannels = dataChannels
              ? Array.from(dataChannels.values() as RTCDataChannel[])
                  .some((ch) => ch.readyState === 'open')
              : false;

            if (!hasActiveChannels) {
              connectionState = 'disconnected';
            }
          }

          networkStats = {
            ping: stats.ping,
            jitter: stats.jitter,
            state: connectionState,
          };
        }
      }

      this.hud.update({
        speedKmh: vehicle.getSpeedKmh(),
        gear: estimateGear(forwardSpeedKmh, input.throttle, input.brake),
        currentLap: lapState.currentLap,
        totalLaps: this.totalLaps,
        lapTimeMs: lapState.currentLapTime * 1000,
        lastLapMs: Number.isNaN(lapState.lastLapTime) ? null : lapState.lastLapTime * 1000,
        bestLapMs: Number.isNaN(lapState.bestLapTime) ? null : lapState.bestLapTime * 1000,
        position: Math.max(1, Math.min(totalCars, position)),
        totalCars,
        networkStats,
      });
    }

    // Render
    this.renderService.setSpeed(vehicle.getSpeedKmh());
    this.renderService.render(dt);
  }

  async exit(): Promise<void> {
    if (this.context) {
      this.context.eventBus.off('race:all-finished', this.handleRaceFinished);
      if (this.gameMode !== 'single') {
        this.context.eventBus.off('network:player-color-changed', this.handlePlayerColorChanged);
      }
    }

    if (this.onKeyDown) {
      window.removeEventListener('keydown', this.onKeyDown);
      this.onKeyDown = null;
    }

    if (this.inputService) {
      this.inputService.disable();
    }

    if (this.hud) {
      document.body.removeChild(this.hud.root);
      this.hud = null;
    }

    // Clean up Three.js scene objects to prevent memory leak
    if (this.renderService) {
      const scene = this.renderService.getScene();

      // Dispose track Rapier resources (colliders for track, barriers, checkpoints)
      if (this.track) {
        this.track.dispose();
        this.track = null;
      }

      // Remove track mesh (includes asphalt, kerbs, barriers, start/finish)
      if (this.trackMesh) {
        scene.remove(this.trackMesh);
        // Dispose geometries and materials
        this.trackMesh.traverse((child) => {
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
        this.trackMesh = null;
      }

      // Remove ground mesh
      if (this.groundMesh) {
        scene.remove(this.groundMesh);
        if (this.groundMesh.geometry) this.groundMesh.geometry.dispose();
        if (this.groundMesh.material instanceof THREE.Material) {
          this.groundMesh.material.dispose();
        }
        this.groundMesh = null;
      }

      // Remove ground grid
      if (this.groundGrid) {
        scene.remove(this.groundGrid);
        if (this.groundGrid.geometry) this.groundGrid.geometry.dispose();
        if (this.groundGrid.material instanceof THREE.Material) {
          this.groundGrid.material.dispose();
        }
        this.groundGrid = null;
      }

      // Remove vehicle meshes (chassis + wheels)
      this.vehicleMeshes.forEach((mesh) => {
        scene.remove(mesh);
        if (mesh instanceof THREE.Mesh) {
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material) {
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach((mat) => mat.dispose());
            } else {
              mesh.material.dispose();
            }
          }
        }
      });
      this.vehicleMeshes = [];
    }

    if (this.raceController) {
      this.raceController.dispose();
      this.raceController = null;
    }

    if (this.opponentController) {
      this.opponentController.dispose();
      this.opponentController = null;
    }

    // Clean up guest vehicles
    this.guestVehicles.forEach((_guestData, guestId) => {
      if (this.physicsService) {
        this.physicsService.destroyVehicle(guestId);
      }
    });
    this.guestVehicles.clear();

    // Clean up local player vehicle
    if (this.physicsService) {
      this.physicsService.destroyVehicle('local');
    }

    this.playerController = null;
    this.clientPrediction = null;
    this.physicsService = null;
    this.renderService = null;
    this.inputService = null;
    this.context = null;
  }

  private initializeMultiplayerOpponents(): void {
    if (!this.opponentController || !this.roomInfo || !this.playerController || !this.track) return;

    console.log(`[RacingState] Initializing multiplayer opponents after first physics update`);
    console.log(`[RacingState] roomInfo has ${this.roomInfo.players.length} players:`,
      this.roomInfo.players.map(p => `${p.id}(${p.name},0x${p.carColor.toString(16)})`).join(', '));
    console.log(`[RacingState] My playerId: ${this.playerId}`);

    // Get base spawn position and rotation from track
    const spawn = this.track.lapInfo.spawn;
    const baseSpawnPos = spawn.position.clone();
    const baseSpawnRot = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.atan2(-spawn.forward.x, -spawn.forward.z)
    );

    console.log(`[RacingState] Base spawn position:`, baseSpawnPos);

    // Create visual meshes for all other players
    this.roomInfo.players.forEach(player => {
      if (player.id !== this.playerId) {
        console.log(`[RacingState] Creating opponent mesh: ${player.id} (${player.name}) with color 0x${player.carColor.toString(16)}`);
        this.opponentController!.addRemotePlayer(player.id, player.name, player.carColor, false);

        // Calculate spawn position for this opponent
        const opponentSpawnPos = this.getOpponentSpawnPosition(player.id, baseSpawnPos);
        console.log(`[RacingState] Setting opponent ${player.id} initial position:`, opponentSpawnPos);
        this.opponentController!.setInitialPosition(player.id, opponentSpawnPos, baseSpawnRot);
      } else {
        console.log(`[RacingState] Skipping self: ${player.id}`);
      }
    });

    // Send first snapshot with validated position
    if (this.gameMode === 'multi_host') {
      this.sendImmediateSnapshot();
      console.log('[RacingState] Host sent first snapshot after opponent initialization');
    }
  }

  private handleRaceFinished = () => {
    if (this.context) {
      const results = this.raceController?.getResults() ?? [];
      this.context.eventBus.emit('game:request-state-change', { from: 'racing', to: 'results' });
      // Pass results to next state
      if (this.context.data) {
        this.context.data.raceResults = results;
      }
    }
  };

  private handlePause = () => {
    if (this.context) {
      this.context.eventBus.emit('game:request-state-change', { from: 'racing', to: 'pause' });
    }
  };

  private updateHostBroadcast(dt: number): void {
    if (!this.networkService || !this.playerController || !this.raceController) {
      console.log('[HOST_BROADCAST] Early return: networkService=%s, playerController=%s, raceController=%s',
        !!this.networkService, !!this.playerController, !!this.raceController);
      return;
    }

    this.lastSnapshotTime += dt * 1000; // Convert to ms

    if (this.lastSnapshotTime >= this.snapshotInterval) {
      this.lastSnapshotTime = 0;
      this.hostTick++;

      const vehicle = this.playerController.getVehicle();
      const lapState = this.raceController.getPlayerLapState('local');
      const position = vehicle.rigidBody.translation();
      const rotation = vehicle.rigidBody.rotation();
      const velocity = vehicle.rigidBody.linvel();

      console.log('[HOST_BROADCAST] Tick %d: Preparing snapshot', this.hostTick);
      console.log('[HOST_BROADCAST] Host position: (%.2f, %.2f, %.2f), speed: %.1f km/h',
        position.x, position.y, position.z, vehicle.getSpeedKmh());

      // Build players array - start with host
      const players = [{
        id: this.playerId!,
        name: this.roomInfo?.players.find(p => p.id === this.playerId)?.name ?? 'Host',
        carColor: this.roomInfo?.players.find(p => p.id === this.playerId)?.carColor ?? 0xe10600,
        position: [position.x, position.y, position.z] as [number, number, number],
        rotation: [rotation.x, rotation.y, rotation.z, rotation.w] as [number, number, number, number],
        velocity: [velocity.x, velocity.y, velocity.z] as [number, number, number],
        speedKmh: vehicle.getSpeedKmh(),
        gear: estimateGear(vehicle.getForwardSpeedKmh(), 0, 0),
        currentLap: lapState.currentLap,
        lapTimeMs: lapState.currentLapTime * 1000,
        lastLapMs: Number.isNaN(lapState.lastLapTime) ? null : lapState.lastLapTime * 1000,
        bestLapMs: Number.isNaN(lapState.bestLapTime) ? null : lapState.bestLapTime * 1000,
      }];

      console.log('[HOST_BROADCAST] Host data: id=%s, name=%s, color=0x%s',
        this.playerId, players[0].name, players[0].carColor.toString(16));

      // Add guest players
      console.log('[HOST_BROADCAST] Guest vehicles count: %d', this.guestVehicles.size);
      this.guestVehicles.forEach((guestData, guestId) => {
        const guestVehicle = guestData.vehicle;
        const guestLapState = this.raceController!.getPlayerLapState(guestId);
        const guestPos = guestVehicle.rigidBody.translation();
        const guestRot = guestVehicle.rigidBody.rotation();
        const guestVel = guestVehicle.rigidBody.linvel();

        console.log('[HOST_BROADCAST] Guest %s position: (%.2f, %.2f, %.2f), speed: %.1f km/h',
          guestId, guestPos.x, guestPos.y, guestPos.z, guestVehicle.getSpeedKmh());

        players.push({
          id: guestId,
          name: this.roomInfo?.players.find(p => p.id === guestId)?.name ?? 'Guest',
          carColor: this.roomInfo?.players.find(p => p.id === guestId)?.carColor ?? 0xe10600,
          position: [guestPos.x, guestPos.y, guestPos.z] as [number, number, number],
          rotation: [guestRot.x, guestRot.y, guestRot.z, guestRot.w] as [number, number, number, number],
          velocity: [guestVel.x, guestVel.y, guestVel.z] as [number, number, number],
          speedKmh: guestVehicle.getSpeedKmh(),
          gear: estimateGear(guestVehicle.getForwardSpeedKmh(), 0, 0),
          currentLap: guestLapState.currentLap,
          lapTimeMs: guestLapState.currentLapTime * 1000,
          lastLapMs: Number.isNaN(guestLapState.lastLapTime) ? null : guestLapState.lastLapTime * 1000,
          bestLapMs: Number.isNaN(guestLapState.bestLapTime) ? null : guestLapState.bestLapTime * 1000,
        });
      });

      const snapshot = {
        type: 'snapshot' as const,
        tick: this.hostTick,
        timestamp: performance.now(),
        players,
      };

      // Log every 50th snapshot to avoid spam
      if (this.hostTick % 50 === 0) {
        console.log('[HOST_BROADCAST] ===== SNAPSHOT SUMMARY (tick %d) =====', this.hostTick);
        console.log('[HOST_BROADCAST] Total players in snapshot: %d', players.length);
        console.log('[HOST_BROADCAST] this.players Map size: N/A (using players array)');
        console.log('[HOST_BROADCAST] this.guestVehicles Map size: %d', this.guestVehicles.size);

        players.forEach((player, index) => {
          console.log('[HOST_BROADCAST] Player %d/%d: id=%s, name=%s, color=0x%s',
            index + 1, players.length, player.id, player.name, player.carColor.toString(16));
          console.log('[HOST_BROADCAST]   Position: (%.2f, %.2f, %.2f)',
            player.position[0], player.position[1], player.position[2]);
          console.log('[HOST_BROADCAST]   Velocity: (%.2f, %.2f, %.2f), Speed: %.1f km/h',
            player.velocity[0], player.velocity[1], player.velocity[2], player.speedKmh);
        });

        console.log('[HOST_BROADCAST] ===== END SNAPSHOT SUMMARY =====');
      }

      console.log('[HOST_BROADCAST] Broadcasting snapshot with %d players to guests', players.length);
      this.networkService.broadcastToGuests(snapshot);
      console.log('[HOST_BROADCAST] Snapshot sent successfully');
    }
  }

  private setupMultiplayerListeners(): void {
    if (!this.networkService) return;

    const client = this.networkService.getClient();
    if (!client) return;

    // Guest receives snapshots from Host
    if (this.gameMode === 'multi_guest') {
      const originalOnHostMessage = client['callbacks'].onHostMessage;
      client['callbacks'].onHostMessage = (message) => {
        if (message.type === 'snapshot') {
          this.handleHostSnapshot(message);
        } else if (message.type === 'race_config') {
          this.handleRaceConfig(message);
        } else if (message.type === 'initial_position') {
          this.handleHostInitialPosition(message);
        }
        if (originalOnHostMessage) {
          originalOnHostMessage(message);
        }
      };
    }

    // Host receives input from Guests
    if (this.gameMode === 'multi_host') {
      const originalOnGuestMessage = client['callbacks'].onGuestMessage;
      client['callbacks'].onGuestMessage = (guestId, message) => {
        if (message.type === 'input') {
          this.handleGuestInput(guestId, message);
        } else if (message.type === 'initial_position') {
          this.handleGuestInitialPosition(guestId, message);
        }
        if (originalOnGuestMessage) {
          originalOnGuestMessage(guestId, message);
        }
      };

      // Handle player disconnection
      const originalOnPlayerLeft = client['callbacks'].onPlayerLeft;
      client['callbacks'].onPlayerLeft = (playerId) => {
        console.log(`[RacingState] Player ${playerId} disconnected during race`);
        this.handlePlayerDisconnect(playerId);
        if (originalOnPlayerLeft) {
          originalOnPlayerLeft(playerId);
        }
      };
    }

    // Guest handles host disconnection
    if (this.gameMode === 'multi_guest') {
      const originalOnError = client['callbacks'].onError;
      client['callbacks'].onError = (message, errorType) => {
        console.error(`[RacingState] Network error: ${message}, type: ${errorType}`);
        // If host disconnects, show error and return to menu
        if (errorType === 'host_disconnected' || message.includes('Connection') || message.includes('lost')) {
          this.handleHostDisconnect();
        }
        if (originalOnError) {
          originalOnError(message, errorType);
        }
      };
    }
  }

  private sendRaceConfig(trackLength: number): void {
    if (!this.networkService) return;

    const config = {
      type: 'race_config' as const,
      totalLaps: this.totalLaps,
      trackLength,
    };

    console.log('[RacingState] Host sending race_config:', config);
    this.networkService.broadcastToGuests(config);
  }

  private sendInitialPosition(): void {
    if (!this.networkService || !this.playerController) return;

    const vehicle = this.playerController.getVehicle();
    const position = vehicle.rigidBody.translation();
    const rotation = vehicle.rigidBody.rotation();

    const message = {
      type: 'initial_position' as const,
      position: [position.x, position.y, position.z] as [number, number, number],
      rotation: [rotation.x, rotation.y, rotation.z, rotation.w] as [number, number, number, number],
    };

    console.log('[RacingState] Sending initial position:', message);

    if (this.gameMode === 'multi_host') {
      this.networkService.broadcastToGuests(message);
    } else if (this.gameMode === 'multi_guest') {
      this.networkService.sendToHost(message);
    }
  }

  private sendImmediateSnapshot(): void {
    if (!this.networkService || !this.playerController || !this.raceController) return;

    const vehicle = this.playerController.getVehicle();
    const lapState = this.raceController.getPlayerLapState('local');
    const position = vehicle.rigidBody.translation();
    const rotation = vehicle.rigidBody.rotation();
    const velocity = vehicle.rigidBody.linvel();

    // Build players array - start with host
    const players = [{
      id: this.playerId!,
      name: this.roomInfo?.players.find(p => p.id === this.playerId)?.name ?? 'Host',
      carColor: this.roomInfo?.players.find(p => p.id === this.playerId)?.carColor ?? 0xe10600,
      position: [position.x, position.y, position.z] as [number, number, number],
      rotation: [rotation.x, rotation.y, rotation.z, rotation.w] as [number, number, number, number],
      velocity: [velocity.x, velocity.y, velocity.z] as [number, number, number],
      speedKmh: vehicle.getSpeedKmh(),
      gear: 1,
      currentLap: lapState.currentLap,
      lapTimeMs: lapState.currentLapTime * 1000,
      lastLapMs: Number.isNaN(lapState.lastLapTime) ? null : lapState.lastLapTime * 1000,
      bestLapMs: Number.isNaN(lapState.bestLapTime) ? null : lapState.bestLapTime * 1000,
    }];

    // Add guest vehicles if host
    if (this.gameMode === 'multi_host' && this.guestVehicles) {
      this.guestVehicles.forEach((guestData, guestId) => {
        const guestVehicle = guestData.vehicle;
        const guestPos = guestVehicle.rigidBody.translation();
        const guestRot = guestVehicle.rigidBody.rotation();
        const guestVel = guestVehicle.rigidBody.linvel();
        const guestLapState = this.raceController!.getPlayerLapState(guestId);

        players.push({
          id: guestId,
          name: this.roomInfo?.players.find(p => p.id === guestId)?.name ?? 'Guest',
          carColor: this.roomInfo?.players.find(p => p.id === guestId)?.carColor ?? 0x0000ff,
          position: [guestPos.x, guestPos.y, guestPos.z] as [number, number, number],
          rotation: [guestRot.x, guestRot.y, guestRot.z, guestRot.w] as [number, number, number, number],
          velocity: [guestVel.x, guestVel.y, guestVel.z] as [number, number, number],
          speedKmh: guestVehicle.getSpeedKmh(),
          gear: 1,
          currentLap: guestLapState.currentLap,
          lapTimeMs: guestLapState.currentLapTime * 1000,
          lastLapMs: Number.isNaN(guestLapState.lastLapTime) ? null : guestLapState.lastLapTime * 1000,
          bestLapMs: Number.isNaN(guestLapState.bestLapTime) ? null : guestLapState.bestLapTime * 1000,
        });
      });
    }

    const snapshot = {
      type: 'snapshot' as const,
      tick: 0,
      timestamp: performance.now(),
      players,
    };

    console.log('[RacingState] Sending immediate first snapshot:', snapshot);
    this.networkService.broadcastToGuests(snapshot);
  }

  private handleRaceConfig(config: any): void {
    console.log('[RacingState] Guest received race_config:', config);
    // Update local state with host's config
    this.totalLaps = config.totalLaps;
    // Track length is already set by local track creation

    // Guest sends initial position to host after receiving race_config
    this.sendInitialPosition();

    // Send again after a short delay to ensure it arrives
    setTimeout(() => {
      this.sendInitialPosition();
      console.log('[RacingState] Guest sent delayed initial_position for reliability');
    }, 100);
  }

  private handleHostInitialPosition(message: any): void {
    if (!this.opponentController) return;

    console.log('[RacingState] Guest received host initial_position:', message);

    // Update the host's visual mesh position immediately
    const hostPlayer = this.roomInfo?.players.find(p => p.id !== this.playerId);
    if (hostPlayer) {
      const mesh = this.opponentController.getRemotePlayerMesh(hostPlayer.id);
      if (mesh) {
        const [x, y, z] = message.position;
        const [qx, qy, qz, qw] = message.rotation;
        mesh.position.set(x, y, z);
        mesh.quaternion.set(qx, qy, qz, qw);
        console.log(`[RacingState] Updated host mesh position to (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
      }
    }
  }

  private handleGuestInitialPosition(guestId: string, message: any): void {
    if (!this.opponentController) return;

    console.log(`[RacingState] Host received guest ${guestId} initial_position:`, message);

    // Update the guest's visual mesh position immediately
    const mesh = this.opponentController.getRemotePlayerMesh(guestId);
    if (mesh) {
      const [x, y, z] = message.position;
      const [qx, qy, qz, qw] = message.rotation;
      mesh.position.set(x, y, z);
      mesh.quaternion.set(qx, qy, qz, qw);
      console.log(`[RacingState] Updated guest ${guestId} mesh position to (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
    }
  }

  private handleHostSnapshot(snapshot: any): void {
    const now = performance.now();

    console.log('[GUEST_SNAPSHOT] Received snapshot tick=%d, timestamp=%.2f, players=%d',
      snapshot.tick, snapshot.timestamp, snapshot.players.length);

    // If OpponentController not ready yet, buffer the snapshot
    if (!this.opponentController) {
      console.log('[GUEST_SNAPSHOT] OpponentController not ready, buffering snapshot with %d players',
        snapshot.players.length);
      this.pendingSnapshots.push({ snapshot, timestamp: now });
      console.log('[GUEST_SNAPSHOT] Pending snapshots buffer size: %d', this.pendingSnapshots.length);
      return;
    }

    console.log('[GUEST_SNAPSHOT] Processing snapshot with %d players:',
      snapshot.players.length,
      snapshot.players.map((p: any) => `${p.id}(${p.name})`).join(', '));

    // Process all players in snapshot
    snapshot.players.forEach((playerSnapshot: any) => {
      console.log('[GUEST_SNAPSHOT] Processing player: id=%s, name=%s, pos=(%.2f, %.2f, %.2f), speed=%.1f km/h',
        playerSnapshot.id, playerSnapshot.name,
        playerSnapshot.position[0], playerSnapshot.position[1], playerSnapshot.position[2],
        playerSnapshot.speedKmh);

      if (playerSnapshot.id === this.playerId) {
        console.log('[GUEST_SNAPSHOT] This is local player, performing server reconciliation');
        // This is our local player - perform server reconciliation
        if (this.clientPrediction) {
          this.clientPrediction.reconcile(playerSnapshot, now);
          // Clear old inputs that server has processed
          this.clientPrediction.clearOldInputs(snapshot.timestamp);
          console.log('[GUEST_SNAPSHOT] Server reconciliation complete');
        } else {
          console.warn('[GUEST_SNAPSHOT] clientPrediction is null, skipping reconciliation');
        }
      } else {
        console.log('[GUEST_SNAPSHOT] This is remote player (host)');
        // Remote player - add if not exists
        const existingMesh = this.opponentController!.getRemotePlayerMesh(playerSnapshot.id);
        if (!existingMesh) {
          console.log('[GUEST_SNAPSHOT] Creating remote player %s (%s) with color 0x%s',
            playerSnapshot.id, playerSnapshot.name, playerSnapshot.carColor.toString(16));
          this.opponentController!.addRemotePlayer(
            playerSnapshot.id,
            playerSnapshot.name,
            playerSnapshot.carColor,
            false
          );
        } else {
          console.log('[GUEST_SNAPSHOT] Remote player %s mesh already exists, updating position', playerSnapshot.id);
        }

        // Update opponent with snapshot
        console.log('[GUEST_SNAPSHOT] Calling updateRemotePlayer for %s', playerSnapshot.id);
        this.opponentController!.updateRemotePlayer(playerSnapshot, now);
        console.log('[GUEST_SNAPSHOT] updateRemotePlayer complete for %s', playerSnapshot.id);
      }
    });

    console.log('[GUEST_SNAPSHOT] Snapshot processing complete');
  }

  private flushPendingSnapshots(): void {
    if (this.pendingSnapshots.length === 0) {
      console.log('[FLUSH_SNAPSHOTS] No pending snapshots to flush');
      return;
    }

    console.log('[FLUSH_SNAPSHOTS] Flushing %d buffered snapshots', this.pendingSnapshots.length);

    this.pendingSnapshots.forEach(({ snapshot, timestamp }, index) => {
      console.log('[FLUSH_SNAPSHOTS] Processing buffered snapshot %d/%d: tick=%d, players=%d',
        index + 1, this.pendingSnapshots.length, snapshot.tick, snapshot.players.length);

      // Process snapshot as if it just arrived
      if (!this.opponentController) {
        console.error('[FLUSH_SNAPSHOTS] OpponentController is null during flush!');
        return;
      }

      snapshot.players.forEach((playerSnapshot: any) => {
        if (playerSnapshot.id === this.playerId) {
          console.log('[FLUSH_SNAPSHOTS] Skipping local player reconciliation for buffered snapshot');
          // Skip local player reconciliation for buffered snapshots
          return;
        }

        console.log('[FLUSH_SNAPSHOTS] Processing remote player %s from buffered snapshot', playerSnapshot.id);

        // Remote player - add if not exists
        const existingMesh = this.opponentController!.getRemotePlayerMesh(playerSnapshot.id);
        if (!existingMesh) {
          console.log('[FLUSH_SNAPSHOTS] Creating remote player from buffered snapshot: %s (%s) with color 0x%s',
            playerSnapshot.id, playerSnapshot.name, playerSnapshot.carColor.toString(16));
          this.opponentController!.addRemotePlayer(
            playerSnapshot.id,
            playerSnapshot.name,
            playerSnapshot.carColor,
            false
          );
        } else {
          console.log('[FLUSH_SNAPSHOTS] Remote player %s already exists', playerSnapshot.id);
        }

        // Update opponent with snapshot
        console.log('[FLUSH_SNAPSHOTS] Updating remote player %s with buffered snapshot', playerSnapshot.id);
        this.opponentController!.updateRemotePlayer(playerSnapshot, timestamp);
      });
    });

    // Clear buffer
    this.pendingSnapshots = [];
    console.log('[FLUSH_SNAPSHOTS] Pending snapshots buffer cleared');
  }

  private sendGuestInput(input: InputState, dt: number): void {
    if (!this.networkService) {
      console.log('[GUEST_INPUT] Early return: networkService is null');
      return;
    }

    this.lastInputSendTime += dt * 1000; // Convert to ms

    if (this.lastInputSendTime >= this.inputSendInterval) {
      this.lastInputSendTime = 0;
      this.inputSeq++;

      const timestamp = performance.now();

      const inputMessage = {
        type: 'input' as const,
        seq: this.inputSeq,
        throttle: input.throttle,
        brake: input.brake,
        steer: input.steer,
        timestamp,
      };

      console.log('[GUEST_INPUT] Sending input seq=%d: throttle=%.2f, brake=%.2f, steer=%.2f, timestamp=%.2f',
        this.inputSeq, input.throttle, input.brake, input.steer, timestamp);

      // Record input for client-side prediction
      if (this.clientPrediction) {
        this.clientPrediction.recordInput(this.inputSeq, input, timestamp);
        console.log('[GUEST_INPUT] Recorded input for client-side prediction');
      } else {
        console.warn('[GUEST_INPUT] clientPrediction is null, skipping input recording');
      }

      this.networkService.sendToHost(inputMessage);
      console.log('[GUEST_INPUT] Input sent to host');
    }
  }

  private handleGuestInput(guestId: string, input: any): void {
    if (!this.physicsService || !this.renderService) {
      console.log('[HOST_INPUT] Early return: physicsService=%s, renderService=%s',
        !!this.physicsService, !!this.renderService);
      return;
    }

    console.log('[HOST_INPUT] Received input from guest %s: seq=%d, throttle=%.2f, brake=%.2f, steer=%.2f',
      guestId, input.seq, input.throttle, input.brake, input.steer);

    // Create guest vehicle if it doesn't exist
    if (!this.guestVehicles.has(guestId)) {
      console.log('[HOST_INPUT] Guest vehicle does not exist, creating it');
      this.createGuestVehicle(guestId);
    }

    const guestData = this.guestVehicles.get(guestId);
    if (guestData) {
      // Store the latest input
      guestData.lastInput = {
        throttle: input.throttle,
        brake: input.brake,
        steer: input.steer,
      };
      console.log('[HOST_INPUT] Stored input for guest %s: throttle=%.2f, brake=%.2f, steer=%.2f',
        guestId, guestData.lastInput.throttle, guestData.lastInput.brake, guestData.lastInput.steer);
    } else {
      console.error('[HOST_INPUT] Failed to get guest data after creation for %s', guestId);
    }
  }

  private createGuestVehicle(guestId: string): void {
    if (!this.physicsService || !this.renderService || !this.raceController || !this.playerController) return;

    const scene = this.renderService.getScene();

    // Check if guest vehicle already exists (from previous failed transition)
    const existingVehicle = this.physicsService.getVehicle(guestId);
    if (existingVehicle) {
      console.warn(`[RacingState] Found existing vehicle for guest ${guestId}, destroying it before creating new one`);
      this.physicsService.destroyVehicle(guestId);
    }

    // Get guest color from roomInfo
    const guestColor = this.roomInfo?.players.find(p => p.id === guestId)?.carColor;
    const vehicle = this.physicsService.createVehicle(guestId, scene, guestColor);

    // Track vehicle meshes for cleanup
    this.vehicleMeshes.push(vehicle.chassisMesh);
    this.vehicleMeshes.push(...vehicle.wheelMeshes);

    // Get track info from player controller
    const track = this.playerController['track'];
    const spawn = track.lapInfo.spawn;
    const yawSpawn = Math.atan2(-spawn.forward.x, -spawn.forward.z);

    // Guest always spawns on right (host is on left)
    const spawnPos = spawn.position.clone();
    spawnPos.x += 1.5;

    vehicle.rigidBody.setTranslation(spawnPos, true);
    vehicle.rigidBody.setRotation(
      { x: 0, y: Math.sin(yawSpawn / 2), z: 0, w: Math.cos(yawSpawn / 2) },
      true
    );
    vehicle.syncVisuals();

    // Create controller for guest
    const controller = new PlayerController(vehicle, track);

    // Add to race controller
    const guestName = this.roomInfo?.players.find(p => p.id === guestId)?.name ?? 'Guest';
    this.raceController.addPlayer(guestId, guestName, vehicle.rigidBody);

    this.guestVehicles.set(guestId, {
      vehicle,
      lastInput: { throttle: 0, brake: 0, steer: 0 },
      controller,
    });

    console.log(`[RacingState] Created vehicle for guest ${guestId} (${guestName})`);
  }

  private updateGuestVehicles(dt: number): void {
    console.log('[HOST_GUEST_UPDATE] Updating %d guest vehicles, dt=%.3f', this.guestVehicles.size, dt);
    this.guestVehicles.forEach((guestData, guestId) => {
      const input = guestData.lastInput;
      console.log('[HOST_GUEST_UPDATE] Applying input to guest %s: throttle=%.2f, brake=%.2f, steer=%.2f',
        guestId, input.throttle, input.brake, input.steer);

      // Get position before update
      const posBefore = guestData.vehicle.rigidBody.translation();
      const speedBefore = guestData.vehicle.getSpeedKmh();

      // Apply the latest input to the guest vehicle
      guestData.controller.update(guestData.lastInput, dt);

      // Get position after update
      const posAfter = guestData.vehicle.rigidBody.translation();
      const speedAfter = guestData.vehicle.getSpeedKmh();

      console.log('[HOST_GUEST_UPDATE] Guest %s: before pos=(%.2f, %.2f, %.2f) speed=%.1f, after pos=(%.2f, %.2f, %.2f) speed=%.1f',
        guestId, posBefore.x, posBefore.y, posBefore.z, speedBefore,
        posAfter.x, posAfter.y, posAfter.z, speedAfter);
    });
  }

  /**
   * Update visual meshes of guest players on the host.
   * This ensures that the host sees guest cars in the correct positions.
   */
  private updateGuestVisuals(): void {
    if (this.gameMode !== 'multi_host' || !this.opponentController) {
      return;
    }

    console.log('[HOST_GUEST_VISUALS] Updating visuals for %d guests', this.guestVehicles.size);

    this.guestVehicles.forEach((guestData, guestId) => {
      const vehicle = guestData.vehicle;
      const position = vehicle.chassisMesh.position.clone();
      const rotation = vehicle.chassisMesh.quaternion.clone();

      console.log('[HOST_GUEST_VISUALS] Guest %s: mesh pos=(%.2f, %.2f, %.2f)',
        guestId, position.x, position.y, position.z);

      // Update the visual mesh directly (no interpolation needed on host)
      this.opponentController!.updateRemotePlayerDirect(guestId, position, rotation);
      console.log('[HOST_GUEST_VISUALS] Updated visual mesh for guest %s', guestId);
    });
  }

  private handlePlayerDisconnect(playerId: string): void {
    console.log(`[RacingState] Handling disconnect for player ${playerId}`);

    // Remove guest vehicle from physics and scene (Host only)
    const guestData = this.guestVehicles.get(playerId);
    if (guestData) {
      // Remove from physics
      if (this.physicsService) {
        this.physicsService.destroyVehicle(playerId);
      }

      // Remove from race controller
      if (this.raceController) {
        this.raceController.removePlayer(playerId);
      }

      // Remove from map
      this.guestVehicles.delete(playerId);
      console.log(`[RacingState] Removed guest vehicle for ${playerId}`);
    }

    // Remove from remote opponents (visual representation)
    if (this.opponentController) {
      this.opponentController.removeRemotePlayer(playerId);
    }

    // Show notification to remaining players
    const playerName = this.roomInfo?.players.find(p => p.id === playerId)?.name ?? 'Player';
    console.log(`[RacingState] ${playerName} disconnected`);
    if (this.hud) {
      this.hud.showNotification(`${playerName} disconnected`, 'warning', 5000);
    }
  }

  private handleHostDisconnect(): void {
    console.error('[RacingState] Host disconnected! Returning to menu...');

    // Show error message
    if (this.hud) {
      this.hud.showError('Host disconnected. Returning to menu...');
    }

    // Return to menu after a short delay to let user see the notification
    setTimeout(() => {
      if (this.context) {
        this.context.eventBus.emit('game:request-state-change', { from: 'racing', to: 'menu' });
      }
    }, 2000);
  }

  private handlePlayerColorChanged = (data: { playerId: string; color: number }) => {
    console.log(`[RacingState] Player ${data.playerId} changed color to ${data.color.toString(16)}`);

    // Update roomInfo
    if (this.roomInfo) {
      const player = this.roomInfo.players.find(p => p.id === data.playerId);
      if (player) {
        player.carColor = data.color;
      }
    }

    // Update vehicle color if it exists
    if (data.playerId === this.playerId) {
      // Local player color changed
      const vehicle = this.playerController?.getVehicle();
      if (vehicle) {
        this.updateVehicleColor(vehicle.chassisMesh, data.color);
      }
    } else {
      // Guest vehicle color changed (Host only)
      const guestData = this.guestVehicles.get(data.playerId);
      if (guestData) {
        this.updateVehicleColor(guestData.vehicle.chassisMesh, data.color);
      }
    }
  };

  private updateVehicleColor(chassisMesh: THREE.Object3D, color: number): void {
    // Update all body parts that use the main color
    chassisMesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        // Only update materials that were originally the Ferrari red (0xe10600)
        const currentColor = child.material.color.getHex();
        if (currentColor === 0xe10600 || child.material.userData.isBodyColor) {
          child.material = child.material.clone();
          child.material.color.setHex(color);
          child.material.userData.isBodyColor = true;
        }
      }
    });
  }

  /**
   * Calculate spawn position for an opponent based on their player ID.
   * Host spawns on the left (-X), guests spawn on the right (+X) with increasing offsets.
   */
  private getOpponentSpawnPosition(opponentId: string, baseSpawnPos: THREE.Vector3): THREE.Vector3 {
    // Use local player's final spawn position (after offset) as reference
    const referencePos = this.localPlayerSpawnPos ?? baseSpawnPos;
    const spawnPos = referencePos.clone();

    if (this.gameMode === 'multi_host') {
      // Host is on the left, so opponents (guests) spawn on the right
      // Find the index of this opponent in the room
      const opponentIndex = this.roomInfo?.players.findIndex(p => p.id === opponentId) ?? 0;
      const offset = 3.0 + (opponentIndex * 2); // 3.0, 5.0, 7.0, etc. (relative to host position)
      spawnPos.x += offset;
      console.log(`[RacingState] Opponent ${opponentId} spawn: reference=${referencePos.x.toFixed(2)}, offset=+${offset.toFixed(2)}, final=${spawnPos.x.toFixed(2)}`);
    } else if (this.gameMode === 'multi_guest') {
      // Guest is on the right, so opponent (host) spawns on the left
      const offset = -3.0; // 3.0 meters to the left of guest
      spawnPos.x += offset;
      console.log(`[RacingState] Opponent ${opponentId} spawn: reference=${referencePos.x.toFixed(2)}, offset=${offset.toFixed(2)}, final=${spawnPos.x.toFixed(2)}`);
    }

    return spawnPos;
  }
}
