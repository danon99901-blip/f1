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
import { AdaptiveNetworkConfig } from '../client/network/NetworkConfig';
import { createTrack } from '../track/track';
import { createGround } from '../scene';
import { createHud, type Gear } from '../hud/hud';
import { expDecayBlend } from '../utils/math';
import type { RoomInfo, InputState } from '../shared/types';
import type { HostSnapshot, PlayerSnapshot } from '../shared/protocol';
import { MultiplayerDebugOverlay } from '../debug/MultiplayerDebugOverlay';
import { NetworkDiagnostics } from '../debug/NetworkDiagnostics';
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
  private networkConfig = new AdaptiveNetworkConfig();

  // Guest input state
  private inputSeq = 0;
  private lastInputSendTime = 0;
  private clientPrediction: ClientPrediction | null = null;

  // Host: guest vehicle simulation
  // `lastInputAt` is the wall-clock timestamp (ms) of the most recent input received from
  // this guest. updateGuestVehicles() uses it to zero out stale inputs so a disconnected
  // guest's car doesn't drive forever on its last recorded throttle/steer.
  private guestVehicles = new Map<string, {
    vehicle: any; // Vehicle from PhysicsService
    lastInput: { throttle: number; brake: number; steer: number };
    lastInputAt: number;
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

  // Debug counters for logging
  private _snapshotCount = 0;
  private _bufferLogCount = 0;
  private _processedSnapshotCount = 0;
  private _lastSnapshotTimestamp = 0;
  private _guestUpdateTick = 0;
  private _handleInputCount = 0;
  private _guestEventCount = 0;

  // Debug overlay for browser verification
  private debugOverlay: MultiplayerDebugOverlay | null = null;
  private netDiag = NetworkDiagnostics.getInstance();

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
    }

    console.log('[RacingState] Creating HUD...');
    // Setup HUD
    this.hud = createHud();
    document.body.appendChild(this.hud.root);

    // Setup debug overlay for multiplayer
    if (this.gameMode !== 'single') {
      this.debugOverlay = new MultiplayerDebugOverlay();
      console.log('[RacingState] Debug overlay created');
    }

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
        // Eagerly spawn a Rapier vehicle for every remote player in the room. Previously
        // guest vehicles were created lazily on the first `input` message — but inputs
        // only flow once the WebRTC data channel opens, which can take several seconds
        // (or fail silently behind NAT). Creating eagerly here means the host's snapshot
        // broadcasts already include all players from frame 1, and remote cars appear in
        // the host's scene immediately rather than on first input arrival.
        if (this.roomInfo) {
          this.roomInfo.players.forEach(player => {
            if (player.id !== this.playerId && !this.guestVehicles.has(player.id)) {
              console.log(`[RacingState] Eagerly creating vehicle for guest ${player.id} (${player.name})`);
              this.createGuestVehicle(player.id);
            }
          });
        }

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
      // Debug: Print network diagnostics with D key
      if (e.code === 'KeyD' && this.gameMode !== 'single') {
        this.netDiag.printSummary();
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

    // Update network config based on ping
    if (this.gameMode !== 'single' && this.networkService) {
      const stats = this.networkService.getNetworkStats();
      if (stats && stats.ping > 0) {
        const oldDelay = this.networkConfig.getInterpolationDelay();
        this.networkConfig.updateFromPing(stats.ping);
        const newDelay = this.networkConfig.getInterpolationDelay();

        // Update interpolation delay if it changed
        if (oldDelay !== newDelay && this.opponentController) {
          this.opponentController.updateInterpolationDelay(newDelay);
        }
      }
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

    // Update debug overlay for multiplayer
    if (this.debugOverlay && this.gameMode !== 'single') {
      const opponentsVisible = this.opponentController
        ? Array.from(this.roomInfo?.players ?? [])
            .filter(p => p.id !== this.playerId)
            .map(p => ({
              id: p.id,
              name: p.name,
              visible: this.opponentController!.getRemotePlayerMesh(p.id) !== null
            }))
        : [];

      this.debugOverlay.update({
        mode: this.gameMode,
        playerId: this.playerId ?? 'unknown',
        roomCode: this.roomInfo?.roomId ?? 'unknown',
        snapshotsReceived: this._snapshotCount,
        snapshotsProcessed: this._processedSnapshotCount,
        opponentsVisible,
        lastSnapshotTime: this._lastSnapshotTimestamp
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
        // Unsubscribe from network events
        if (this.gameMode === 'multi_guest') {
          this.context.eventBus.off('network:host-message', this.handleNetworkHostMessage);
          this.context.eventBus.off('error:network', this.handleNetworkError);
        }
        if (this.gameMode === 'multi_host') {
          this.context.eventBus.off('network:guest-message', this.handleNetworkGuestMessage);
          this.context.eventBus.off('network:player-left', this.handlePlayerDisconnectEvent);
        }
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

    if (this.debugOverlay) {
      this.debugOverlay.destroy();
      this.debugOverlay = null;
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
    console.log(`[RacingState] Game mode: ${this.gameMode}`);

    // Get base spawn position and rotation from track
    const spawn = this.track.lapInfo.spawn;
    const baseSpawnPos = spawn.position.clone();
    const baseSpawnRot = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.atan2(-spawn.forward.x, -spawn.forward.z)
    );

    console.log(`[RacingState] Base spawn position:`, baseSpawnPos);

    // Guest: Create visual meshes for all other players (host)
    // Host: Guest vehicles already have physics meshes, no need for OpponentController meshes
    if (this.gameMode === 'multi_guest') {
      console.log(`[RacingState] Guest mode: Creating visual meshes for other players`);
      let createdCount = 0;
      this.roomInfo.players.forEach(player => {
        if (player.id !== this.playerId) {
          console.log(`[RacingState] Creating opponent mesh: ${player.id} (${player.name}) with color 0x${player.carColor.toString(16)}`);
          this.opponentController!.addRemotePlayer(player.id, player.name, player.carColor, false);

          // Calculate spawn position for this opponent
          const opponentSpawnPos = this.getOpponentSpawnPosition(player.id, baseSpawnPos);
          console.log(`[RacingState] Setting opponent ${player.id} initial position:`, opponentSpawnPos);
          this.opponentController!.setInitialPosition(player.id, opponentSpawnPos, baseSpawnRot);
          createdCount++;
        } else {
          console.log(`[RacingState] Skipping self: ${player.id}`);
        }
      });
      console.log(`[RacingState] Guest created ${createdCount} opponent meshes`);
    } else {
      console.log(`[RacingState] Host mode: Guest vehicles use physics meshes, skipping OpponentController mesh creation`);
    }

    // Send first snapshot with validated position
    if (this.gameMode === 'multi_host') {
      this.sendImmediateSnapshot();
      console.log('[RacingState] Host sent first snapshot after opponent initialization');
    }

    // Process any buffered snapshots that arrived before opponent initialization (Guest only)
    if (this.gameMode === 'multi_guest') {
      console.log(`[RacingState] Guest has ${this.pendingSnapshots.length} pending snapshots to flush`);
      this.flushPendingSnapshots();
      console.log('[RacingState] Guest flushed pending snapshots after opponent initialization');
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
    if (!this.networkService || !this.playerController || !this.raceController) return;

    this.lastSnapshotTime += dt * 1000; // Convert to ms

    const snapshotInterval = this.networkConfig.getSnapshotInterval();
    if (this.lastSnapshotTime >= snapshotInterval) {
      this.lastSnapshotTime = 0;
      this.hostTick++;

      const snapshot = this.createSnapshot();
      this.netDiag.log('Host sending snapshot', { tick: this.hostTick, playerCount: snapshot.players.length });

      // Diagnostic: log every 20th snapshot (~once per second at 20Hz) so we can
      // confirm the host loop is actually running and producing snapshots.
      if (this.hostTick % 20 === 0) {
        console.log(`[RacingState] HOST broadcast tick=${this.hostTick} players=${snapshot.players.length}`,
          snapshot.players.map(p => `${p.name}(${p.position[0].toFixed(1)},${p.position[2].toFixed(1)})`).join(' | '));
      }

      this.networkService.broadcastToGuests(snapshot);
    }
  }

  private createSnapshot(): HostSnapshot {
    const vehicle = this.playerController!.getVehicle();
    const lapState = this.raceController!.getPlayerLapState('local');
    const position = vehicle.rigidBody.translation();
    const rotation = vehicle.rigidBody.rotation();
    const velocity = vehicle.rigidBody.linvel();

    // Build players array - start with host
    const players: PlayerSnapshot[] = [{
      id: this.playerId!,
      name: this.roomInfo?.players.find(p => p.id === this.playerId)?.name ?? 'Host',
      carColor: this.roomInfo?.players.find(p => p.id === this.playerId)?.carColor ?? 0xe10600,
      position: [position.x, position.y, position.z],
      rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
      velocity: [velocity.x, velocity.y, velocity.z],
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
        position: [guestPos.x, guestPos.y, guestPos.z],
        rotation: [guestRot.x, guestRot.y, guestRot.z, guestRot.w],
        velocity: [guestVel.x, guestVel.y, guestVel.z],
        speedKmh: guestVehicle.getSpeedKmh(),
        gear: estimateGear(guestVehicle.getForwardSpeedKmh(), 0, 0),
        currentLap: guestLapState.currentLap,
        lapTimeMs: guestLapState.currentLapTime * 1000,
        lastLapMs: Number.isNaN(guestLapState.lastLapTime) ? null : guestLapState.lastLapTime * 1000,
        bestLapMs: Number.isNaN(guestLapState.bestLapTime) ? null : guestLapState.bestLapTime * 1000,
      });
    });

    return {
      type: 'snapshot',
      tick: this.hostTick,
      timestamp: performance.now(),
      players,
    };
  }

  private setupMultiplayerListeners(): void {
    if (!this.networkService || !this.context) return;

    console.log('[RacingState] Setting up multiplayer listeners, mode:', this.gameMode);

    // Guest receives snapshots from Host
    if (this.gameMode === 'multi_guest') {
      this.context.eventBus.on('network:host-message', this.handleNetworkHostMessage);
      this.context.eventBus.on('error:network', this.handleNetworkError);
      console.log('[RacingState] Guest subscribed to network:host-message and error:network events');
    }

    // Host receives input from Guests
    if (this.gameMode === 'multi_host') {
      this.context.eventBus.on('network:guest-message', this.handleNetworkGuestMessage);
      this.context.eventBus.on('network:player-left', this.handlePlayerDisconnectEvent);
      console.log('[RacingState] Host subscribed to network:guest-message and network:player-left events');
    }
  }

  private handleNetworkHostMessage = (data: { message: any }) => {
    const message = data.message;

    // Log first few snapshots for debugging
    if (message.type === 'snapshot') {
      this._snapshotCount++;
      if (this._snapshotCount <= 3) {
        console.log(`[RacingState] Guest received snapshot #${this._snapshotCount}:`, {
          tick: message.tick,
          playerCount: message.players.length,
          players: message.players.map((p: any) => ({ id: p.id, name: p.name }))
        });
      }
      this.handleHostSnapshot(message);
    } else if (message.type === 'race_config') {
      console.log('[RacingState] Guest received race_config');
      this.handleRaceConfig(message);
    } else if (message.type === 'initial_position') {
      console.log('[RacingState] Guest received initial_position');
      this.handleHostInitialPosition(message);
    }
  };

  private handleNetworkGuestMessage = (data: { guestId: string; message: any }) => {
    const { guestId, message } = data;

    // Diagnostic: log first 5 messages and every 100th input to confirm event reaches RacingState
    this._guestEventCount = (this._guestEventCount ?? 0) + 1;
    if (this._guestEventCount <= 5 || (message.type === 'input' && this._guestEventCount % 100 === 0)) {
      console.log(`[RacingState] handleNetworkGuestMessage #${this._guestEventCount} type=${message.type} from=${guestId}`);
    }

    if (message.type === 'input') {
      this.handleGuestInput(guestId, message);
    } else if (message.type === 'initial_position') {
      console.log(`[RacingState] Host received initial_position from ${guestId}`);
      this.handleGuestInitialPosition(guestId, message);
    }
  };

  private handlePlayerDisconnectEvent = (data: { playerId: string }) => {
    console.log(`[RacingState] Player ${data.playerId} disconnected during race`);
    this.handlePlayerDisconnect(data.playerId);
  };

  private handleNetworkError = (data: { message: string; errorType?: any }) => {
    console.error(`[RacingState] Network error: ${data.message}, type: ${data.errorType}`);
    // If host disconnects, show error and return to menu
    if (data.errorType === 'host_disconnected' || data.message.includes('Connection') || data.message.includes('lost')) {
      this.handleHostDisconnect();
    }
  };

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

    const snapshot = this.createSnapshot();
    this.networkService.broadcastToGuests(snapshot);
  }

  private handleRaceConfig(config: any): void {
    this.totalLaps = config.totalLaps;
    this.sendInitialPosition();

    // Send again after a short delay to ensure it arrives
    setTimeout(() => {
      this.sendInitialPosition();
    }, 100);
  }

  private handleHostInitialPosition(message: any): void {
    if (!this.opponentController) return;

    const hostPlayer = this.roomInfo?.players.find(p => p.id !== this.playerId);
    if (hostPlayer) {
      const mesh = this.opponentController.getRemotePlayerMesh(hostPlayer.id);
      if (mesh) {
        const [x, y, z] = message.position;
        const [qx, qy, qz, qw] = message.rotation;
        mesh.position.set(x, y, z);
        mesh.quaternion.set(qx, qy, qz, qw);
      }
    }
  }

  private handleGuestInitialPosition(guestId: string, message: any): void {
    if (!this.opponentController) return;

    const mesh = this.opponentController.getRemotePlayerMesh(guestId);
    if (mesh) {
      const [x, y, z] = message.position;
      const [qx, qy, qz, qw] = message.rotation;
      mesh.position.set(x, y, z);
      mesh.quaternion.set(qx, qy, qz, qw);
    }
  }

  private handleHostSnapshot(snapshot: any): void {
    const now = performance.now();
    this._lastSnapshotTimestamp = now;

    this.netDiag.log('Guest received snapshot', { tick: snapshot.tick, playerCount: snapshot.players.length });

    // Diagnostic: log every 20th snapshot to confirm guest is receiving
    if (snapshot.tick % 20 === 0) {
      console.log(`[RacingState] GUEST received tick=${snapshot.tick} players=${snapshot.players.length}`,
        snapshot.players.map((p: any) => `${p.name}(${p.position[0].toFixed(1)},${p.position[2].toFixed(1)})`).join(' | '));
    }

    // If OpponentController not ready yet, buffer the snapshot
    if (!this.opponentController) {
      this.pendingSnapshots.push({ snapshot, timestamp: now });
      this._bufferLogCount++;
      if (this._bufferLogCount <= 3) {
        console.log(`[RacingState] Buffering snapshot #${this._bufferLogCount} (OpponentController not ready yet)`);
      }
      return;
    }

    // Log first few snapshots being processed
    this._processedSnapshotCount++;
    if (this._processedSnapshotCount <= 3) {
      console.log(`[RacingState] Processing snapshot #${this._processedSnapshotCount}:`, {
        tick: snapshot.tick,
        playerCount: snapshot.players.length,
        myId: this.playerId
      });
    }

    this.netDiag.log('Processing snapshot', { tick: snapshot.tick, processedCount: this._processedSnapshotCount });

    // Process all players in snapshot
    snapshot.players.forEach((playerSnapshot: any) => {
      if (playerSnapshot.id === this.playerId) {
        // This is our local player - perform server reconciliation
        if (this.clientPrediction) {
          this.clientPrediction.reconcile(playerSnapshot, snapshot.timestamp);
          this.clientPrediction.clearOldInputs(snapshot.timestamp);
        }
      } else {
        // Remote player (host) - add if not exists
        const existingMesh = this.opponentController!.getRemotePlayerMesh(playerSnapshot.id);
        if (!existingMesh) {
          console.log(`[RacingState] Creating opponent mesh for host ${playerSnapshot.id} (${playerSnapshot.name})`);
          this.netDiag.log('Creating opponent mesh', { id: playerSnapshot.id, name: playerSnapshot.name });
          this.opponentController!.addRemotePlayer(
            playerSnapshot.id,
            playerSnapshot.name,
            playerSnapshot.carColor,
            false
          );
        }

        // Update opponent with snapshot
        if (this._processedSnapshotCount <= 3) {
          console.log(`[RacingState] Updating remote player ${playerSnapshot.id} position:`, {
            pos: playerSnapshot.position,
            rot: playerSnapshot.rotation
          });
        }
        this.netDiag.log('Updating remote player', { id: playerSnapshot.id, pos: playerSnapshot.position });
        this.opponentController!.updateRemotePlayer(playerSnapshot, now);
      }
    });
  }

  private flushPendingSnapshots(): void {
    if (this.pendingSnapshots.length === 0) return;

    this.pendingSnapshots.forEach(({ snapshot, timestamp }) => {
      if (!this.opponentController) return;

      snapshot.players.forEach((playerSnapshot: any) => {
        if (playerSnapshot.id === this.playerId) return;

        // Remote player - add if not exists
        const existingMesh = this.opponentController!.getRemotePlayerMesh(playerSnapshot.id);
        if (!existingMesh) {
          this.opponentController!.addRemotePlayer(
            playerSnapshot.id,
            playerSnapshot.name,
            playerSnapshot.carColor,
            false
          );
        }

        // Update opponent with snapshot
        this.opponentController!.updateRemotePlayer(playerSnapshot, timestamp);
      });
    });

    // Clear buffer
    this.pendingSnapshots = [];
  }

  private sendGuestInput(input: InputState, dt: number): void {
    if (!this.networkService) return;

    this.lastInputSendTime += dt * 1000; // Convert to ms

    const inputSendInterval = this.networkConfig.getInputSendInterval();
    if (this.lastInputSendTime >= inputSendInterval) {
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

      // Diagnostic: log every 60th input (~3s at 20Hz) to confirm guest is sending
      if (this.inputSeq === 1 || this.inputSeq % 60 === 0) {
        console.log(`[RacingState] GUEST sendInput #${this.inputSeq} t=${input.throttle.toFixed(2)} b=${input.brake.toFixed(2)} s=${input.steer.toFixed(2)}`);
      }

      this.networkService.sendToHost(inputMessage);
    }
  }

  private handleGuestInput(guestId: string, input: any): void {
    if (!this.physicsService || !this.renderService) return;

    // Diagnostic: every 60th input log what we received and whether vehicle map has it
    this._handleInputCount = (this._handleInputCount ?? 0) + 1;
    if (this._handleInputCount === 1 || this._handleInputCount % 60 === 0) {
      console.log(
        `[RacingState] HOST handleGuestInput #${this._handleInputCount} from ${guestId} ` +
        `t=${input?.throttle?.toFixed?.(2) ?? input?.throttle} ` +
        `b=${input?.brake?.toFixed?.(2) ?? input?.brake} ` +
        `s=${input?.steer?.toFixed?.(2) ?? input?.steer} ` +
        `vehicleExists=${this.guestVehicles.has(guestId)} ` +
        `mapKeys=[${Array.from(this.guestVehicles.keys()).join(',')}]`
      );
    }

    // Defensive lazy-create: vehicles are normally created eagerly in enter() for every
    // player listed in roomInfo. But if a guest's player_joined arrives mid-race or the
    // initial roomInfo was incomplete, create on first input as a fallback. This used to
    // be the primary code path and caused the "ghost car" bug — see enter() for the eager
    // creation that fixes it.
    if (!this.guestVehicles.has(guestId)) {
      console.warn(`[RacingState] handleGuestInput: vehicle for ${guestId} not found, lazy-creating (this should normally happen in enter())`);
      this.createGuestVehicle(guestId);
    }

    const guestData = this.guestVehicles.get(guestId);
    if (guestData) {
      // Store the latest input + timestamp for stale detection
      guestData.lastInput = {
        throttle: input.throttle,
        brake: input.brake,
        steer: input.steer,
      };
      guestData.lastInputAt = performance.now();
    } else {
      console.error(`[RacingState] handleGuestInput: guestData STILL missing for ${guestId} after lazy-create attempt!`);
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
      lastInputAt: performance.now(),
      controller,
    });

    console.log(`[RacingState] Created vehicle for guest ${guestId} (${guestName})`);
  }

  private updateGuestVehicles(dt: number): void {
    // If we haven't heard from a guest for this long, assume their connection is dead
    // (or temporarily stalled) and stop driving their car with stale inputs. Without
    // this, a disconnected guest's car keeps accelerating with whatever throttle/steer
    // it last sent — flying off the track and confusing the host's snapshots.
    const STALE_INPUT_MS = 500;
    const ZEROED_INPUT = { throttle: 0, brake: 0, steer: 0 };
    const now = performance.now();

    this.guestVehicles.forEach((guestData, guestId) => {
      const isStale = (now - guestData.lastInputAt) > STALE_INPUT_MS;
      const inputToApply = isStale ? ZEROED_INPUT : guestData.lastInput;

      if (isStale && (guestData.lastInput.throttle !== 0 || guestData.lastInput.brake !== 0 || guestData.lastInput.steer !== 0)) {
        // Zero the cached input so we don't log on every frame
        console.warn(`[RacingState] Guest ${guestId} input stale (>${STALE_INPUT_MS}ms) — zeroing throttle/brake/steer`);
        guestData.lastInput = { ...ZEROED_INPUT };
      }

      // Diagnostic: every ~1s log what we're applying to this guest's vehicle and
      // whether its body is actually moving. If position stays constant despite
      // non-zero throttle, the body is stuck (frozen, sleeping, or no ground contact).
      this._guestUpdateTick = (this._guestUpdateTick ?? 0) + 1;
      if (this._guestUpdateTick % 60 === 0) {
        const pos = guestData.vehicle.rigidBody.translation();
        const vel = guestData.vehicle.rigidBody.linvel();
        const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
        console.log(
          `[RacingState] HOST applying guest ${guestId} input ` +
          `t=${inputToApply.throttle.toFixed(2)} b=${inputToApply.brake.toFixed(2)} s=${inputToApply.steer.toFixed(2)} ` +
          `pos=(${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)}) speed=${speed.toFixed(2)}m/s ` +
          `stale=${isStale} ageMs=${Math.round(now - guestData.lastInputAt)}`
        );
      }

      guestData.controller.update(inputToApply, dt);

      // CRITICAL: Sync visual mesh with physics body after update
      guestData.vehicle.syncVisuals();
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
    const spawnPos = baseSpawnPos.clone();

    if (this.gameMode === 'multi_host') {
      // Host is on the left (-1.5), so opponents (guests) spawn on the right
      // Get only guest players (exclude host) and find index among them
      const guestPlayers = this.roomInfo?.players.filter(p => p.id !== this.playerId) ?? [];
      const guestIndex = guestPlayers.findIndex(p => p.id === opponentId);
      const offset = 1.5 + (guestIndex * 2); // First guest at +1.5, second at +3.5, etc.
      spawnPos.x += offset;
      console.log(`[RacingState] Opponent ${opponentId} spawn: base=${baseSpawnPos.x.toFixed(2)}, guestIndex=${guestIndex}, offset=+${offset.toFixed(2)}, final=${spawnPos.x.toFixed(2)}`);
    } else if (this.gameMode === 'multi_guest') {
      // Guest is on the right (+1.5), so opponent (host) spawns on the left
      const offset = -1.5; // Host at -1.5 (base position minus 1.5)
      spawnPos.x += offset;
      console.log(`[RacingState] Opponent ${opponentId} spawn: base=${baseSpawnPos.x.toFixed(2)}, offset=${offset.toFixed(2)}, final=${spawnPos.x.toFixed(2)}`);
    }

    return spawnPos;
  }
}
