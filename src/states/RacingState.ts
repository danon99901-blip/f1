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

      // Pre-create visual meshes for all other players
      if (this.roomInfo) {
        console.log(`[RacingState] roomInfo has ${this.roomInfo.players.length} players:`,
          this.roomInfo.players.map(p => `${p.id}(${p.name},0x${p.carColor.toString(16)})`).join(', '));
        console.log(`[RacingState] My playerId: ${this.playerId}`);

        this.roomInfo.players.forEach(player => {
          if (player.id !== this.playerId) {
            console.log(`[RacingState] Pre-creating player mesh: ${player.id} (${player.name}) with color 0x${player.carColor.toString(16)}`);
            this.opponentController!.addRemotePlayer(player.id, player.name, player.carColor, false);
          } else {
            console.log(`[RacingState] Skipping self: ${player.id}`);
          }
        });
      } else {
        console.warn('[RacingState] No roomInfo available for pre-creating meshes!');
      }
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
      }
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

    this.playerController = null;
    this.clientPrediction = null;
    this.physicsService = null;
    this.renderService = null;
    this.inputService = null;
    this.context = null;
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
    if (!this.networkService || !this.playerController || !this.raceController) return;

    this.lastSnapshotTime += dt * 1000; // Convert to ms

    if (this.lastSnapshotTime >= this.snapshotInterval) {
      this.lastSnapshotTime = 0;
      this.hostTick++;

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
        gear: estimateGear(vehicle.getForwardSpeedKmh(), 0, 0),
        currentLap: lapState.currentLap,
        lapTimeMs: lapState.currentLapTime * 1000,
        lastLapMs: Number.isNaN(lapState.lastLapTime) ? null : lapState.lastLapTime * 1000,
        bestLapMs: Number.isNaN(lapState.bestLapTime) ? null : lapState.bestLapTime * 1000,
      }];

      // Add guest players
      this.guestVehicles.forEach((guestData, guestId) => {
        const guestVehicle = guestData.vehicle;
        const guestLapState = this.raceController!.getPlayerLapState(guestId);
        const guestPos = guestVehicle.rigidBody.translation();
        const guestRot = guestVehicle.rigidBody.rotation();
        const guestVel = guestVehicle.rigidBody.linvel();

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

      this.networkService.broadcastToGuests(snapshot);
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
      client['callbacks'].onError = (message) => {
        console.error(`[RacingState] Network error: ${message}`);
        // If host disconnects, show error and return to menu
        if (message.includes('Connection') || message.includes('lost')) {
          this.handleHostDisconnect();
        }
        if (originalOnError) {
          originalOnError(message);
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

  private handleRaceConfig(config: any): void {
    console.log('[RacingState] Guest received race_config:', config);
    // Update local state with host's config
    this.totalLaps = config.totalLaps;
    // Track length is already set by local track creation
  }

  private handleHostSnapshot(snapshot: any): void {
    if (!this.opponentController) return;

    const now = performance.now();

    console.log(`[RacingState] Received snapshot with ${snapshot.players.length} players:`,
      snapshot.players.map((p: any) => `${p.id}(${p.name})`).join(', '));

    // Process all players in snapshot
    snapshot.players.forEach((playerSnapshot: any) => {
      if (playerSnapshot.id === this.playerId) {
        // This is our local player - perform server reconciliation
        if (this.clientPrediction) {
          this.clientPrediction.reconcile(playerSnapshot, now);
          // Clear old inputs that server has processed
          this.clientPrediction.clearOldInputs(snapshot.timestamp);
        }
      } else {
        // Remote player - add if not exists
        const existingMesh = this.opponentController!.getRemotePlayerMesh(playerSnapshot.id);
        if (!existingMesh) {
          console.log(`[RacingState] Creating remote player ${playerSnapshot.id} (${playerSnapshot.name}) with color 0x${playerSnapshot.carColor.toString(16)}`);
          this.opponentController!.addRemotePlayer(
            playerSnapshot.id,
            playerSnapshot.name,
            playerSnapshot.carColor,
            false
          );
        } else {
          console.log(`[RacingState] Remote player ${playerSnapshot.id} mesh already exists, updating position`);
        }

        // Update opponent with snapshot
        this.opponentController!.updateRemotePlayer(playerSnapshot, now);
      }
    });
  }

  private sendGuestInput(input: InputState, dt: number): void {
    if (!this.networkService) return;

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

      // Record input for client-side prediction
      if (this.clientPrediction) {
        this.clientPrediction.recordInput(this.inputSeq, input, timestamp);
      }

      this.networkService.sendToHost(inputMessage);
    }
  }

  private handleGuestInput(guestId: string, input: any): void {
    if (!this.physicsService || !this.renderService) return;

    // Create guest vehicle if it doesn't exist
    if (!this.guestVehicles.has(guestId)) {
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
    }
  }

  private createGuestVehicle(guestId: string): void {
    if (!this.physicsService || !this.renderService || !this.raceController || !this.playerController) return;

    const scene = this.renderService.getScene();

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
    this.guestVehicles.forEach((guestData) => {
      // Apply the latest input to the guest vehicle
      guestData.controller.update(guestData.lastInput, dt);
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
}
