// Racing state - active race gameplay

import type { GameState, StateContext } from '../core/GameStateMachine';
import type { PhysicsService } from '../services/PhysicsService';
import type { RenderService } from '../services/RenderService';
import type { InputService } from '../services/InputService';
import { RaceController } from '../game/RaceController';
import { PlayerController } from '../game/PlayerController';
import { OpponentController } from '../game/OpponentController';
import { createTrack } from '../track/track';
import { createGround } from '../scene';
import { createHud, type Gear } from '../hud/hud';
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

  async enter(context: StateContext): Promise<void> {
    this.context = context;
    this.gameMode = (context.data?.gameMode as any) ?? 'single';
    this.totalLaps = context.data?.totalLaps ?? 10;

    // Resolve services
    const container = context.data?.serviceContainer;
    if (!container) throw new Error('ServiceContainer not provided');

    this.physicsService = await container.resolve('physics') as PhysicsService;
    this.renderService = await container.resolve('render') as RenderService;
    this.inputService = await container.resolve('input') as InputService;

    // Setup scene
    const scene = this.renderService!.getScene();
    createGround(scene);

    const track = createTrack(this.physicsService!.getWorld(), scene);
    const spawn = track.lapInfo.spawn;
    const yawSpawn = Math.atan2(-spawn.forward.x, -spawn.forward.z);

    // Create race controller
    this.raceController = new RaceController(
      this.totalLaps,
      track,
      this.physicsService!.getWorld(),
      context.eventBus
    );

    // Create local player
    const localVehicle = this.physicsService!.createVehicle('local', scene);
    localVehicle.rigidBody.setTranslation(spawn.position, true);
    localVehicle.rigidBody.setRotation(
      { x: 0, y: Math.sin(yawSpawn / 2), z: 0, w: Math.cos(yawSpawn / 2) },
      true
    );

    this.playerController = new PlayerController(localVehicle, track);
    this.raceController.addPlayer('local', 'Player', localVehicle.rigidBody);

    const playerStartProgress = track.getProgress(spawn.position);
    this.playerArcDistance = playerStartProgress * track.lapInfo.length;

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
      this.opponentController = new OpponentController('remote', scene);
      // Remote players will be added via network events
    }

    // Setup HUD
    this.hud = createHud();
    document.body.appendChild(this.hud.root);

    // Enable input
    this.inputService!.enable();

    // Start race
    this.raceController.start();

    // Listen for race finish
    context.eventBus.on('race:all-finished', this.handleRaceFinished);

    // Setup ESC key to pause
    this.onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        this.handlePause();
      }
    };
    window.addEventListener('keydown', this.onKeyDown);
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

    // Update physics
    this.physicsService.step(dt);

    // Update race controller
    this.raceController.update(dt);

    // Update camera
    this.cameraTarget.copy(vehicle.chassisMesh.position);
    const offsetWorld = this.cameraOffset
      .clone()
      .applyQuaternion(vehicle.chassisMesh.quaternion);
    const camera = this.renderService.getCamera();
    camera.position.lerp(this.cameraTarget.clone().add(offsetWorld), 0.08);
    camera.lookAt(this.cameraTarget);

    // Update HUD
    if (this.hud) {
      const position = this.raceController.getPlayerPosition('local');
      const totalCars = this.raceController.getTotalCars();
      const lapState = this.raceController.getPlayerLapState('local');

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
      });
    }

    // Render
    this.renderService.setSpeed(vehicle.getSpeedKmh());
    this.renderService.render(dt);
  }

  async exit(): Promise<void> {
    if (this.context) {
      this.context.eventBus.off('race:all-finished', this.handleRaceFinished);
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

    if (this.raceController) {
      this.raceController.dispose();
      this.raceController = null;
    }

    if (this.opponentController) {
      this.opponentController.dispose();
      this.opponentController = null;
    }

    this.playerController = null;
    this.physicsService = null;
    this.renderService = null;
    this.inputService = null;
    this.context = null;
  }

  private handleRaceFinished = () => {
    if (this.context) {
      const results = this.raceController?.getResults() ?? [];
      this.context.eventBus.emit('game:state-change', { from: 'racing', to: 'results' });
      // Pass results to next state
      if (this.context.data) {
        this.context.data.raceResults = results;
      }
    }
  };

  private handlePause = () => {
    if (this.context) {
      this.context.eventBus.emit('game:state-change', { from: 'racing', to: 'pause' });
    }
  };
}
