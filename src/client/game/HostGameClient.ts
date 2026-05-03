// Host game client - runs full physics simulation for all players

import * as THREE from 'three';
import { initPhysics, RAPIER } from '../../physics';
import { createScene, createGround } from '../../scene';
import { createVehicle, type Vehicle } from '../../car/vehicle';
import { createTrack } from '../../track/track';
import { createLapTracker } from '../../track/lap';
import { createHud, type Gear } from '../../hud/hud';
import { createComposer } from '../../effects/composer';
import { CountdownOverlay } from './CountdownOverlay';
import { PlayerNameTag } from './PlayerNameTag';
import type { NetworkClient } from '../network/NetworkClient';
import type { PlayerSnapshot } from '../../shared/protocol';
import type { InputState } from '../../shared/types';
import { TICK_RATE, SNAPSHOT_RATE } from '../../shared/constants';
import '../../hud/styles.css';

interface RemotePlayer {
  id: string;
  name: string;
  vehicle: Vehicle;
  lapTracker: ReturnType<typeof createLapTracker>;
  lastInput: InputState;
  arcDistance: number;
  nameTag: PlayerNameTag;
}

function estimateGear(forwardSpeedKmh: number, throttle: number, brake: number): Gear {
  const abs = Math.abs(forwardSpeedKmh);
  if (abs < 1 && throttle === 0 && brake === 0) return 'N';
  if (forwardSpeedKmh < -1) return 'R';
  return Math.max(1, Math.min(8, Math.floor(abs / 40) + 1));
}

export async function startHostGame(
  networkClient: NetworkClient,
  playerNames: { id: string; name: string }[],
  totalLaps: number,
) {
  const appEl = document.getElementById('app');
  const loadingEl = document.getElementById('loading');
  if (!appEl) throw new Error('#app not found');

  loadingEl?.classList.remove('hidden');

  const hud = createHud();
  document.body.appendChild(hud.root);

  const world = await initPhysics();
  const { scene, camera, renderer } = createScene(appEl);
  const composer = createComposer(renderer, scene, camera);
  createGround(scene);

  const groundCollider = RAPIER.ColliderDesc.cuboid(400, 0.1, 400).setTranslation(0, -0.35, 0);
  world.createCollider(groundCollider);

  const track = createTrack(world, scene);
  const spawn = track.lapInfo.spawn;
  const yawSpawn = Math.atan2(-spawn.forward.x, -spawn.forward.z);

  // Create local player (host)
  const localPlayerId = networkClient.getPlayerId()!;
  const localVehicle = createVehicle(world, scene);
  localVehicle.rigidBody.setTranslation(spawn.position, true);
  localVehicle.rigidBody.setRotation(
    { x: 0, y: Math.sin(yawSpawn / 2), z: 0, w: Math.cos(yawSpawn / 2) },
    true,
  );
  const localLapTracker = createLapTracker(track, localVehicle.rigidBody, world);
  const playerStartProgress = track.getProgress(spawn.position);
  let localArcDistance = playerStartProgress * track.lapInfo.length;

  // Create remote players
  const remotePlayers = new Map<string, RemotePlayer>();
  const gridGap = 8.5;
  let gridIndex = 1;

  for (const player of playerNames) {
    if (player.id === localPlayerId) continue;

    const vehicle = createVehicle(world, scene);
    const spawnOffset = new THREE.Vector3()
      .copy(spawn.forward)
      .multiplyScalar(gridIndex * gridGap);
    const remoteSpawnPos = spawn.position.clone().add(spawnOffset);

    vehicle.rigidBody.setTranslation(remoteSpawnPos, true);
    vehicle.rigidBody.setRotation(
      { x: 0, y: Math.sin(yawSpawn / 2), z: 0, w: Math.cos(yawSpawn / 2) },
      true,
    );

    const lapTracker = createLapTracker(track, vehicle.rigidBody, world);
    const startProgress = track.getProgress(remoteSpawnPos);

    const nameTag = new PlayerNameTag(player.name, '#ffffff');
    nameTag.addToScene(scene);

    remotePlayers.set(player.id, {
      id: player.id,
      name: player.name,
      vehicle,
      lapTracker,
      lastInput: { throttle: 0, brake: 0, steer: 0 },
      arcDistance: startProgress * track.lapInfo.length,
      nameTag,
    });

    gridIndex++;
  }

  // Input handling
  const localInput: InputState = { throttle: 0, brake: 0, steer: 0 };
  const codes = new Set<string>();

  const updateInput = () => {
    localInput.throttle = codes.has('KeyW') ? 1 : 0;
    localInput.brake = codes.has('KeyS') || codes.has('Space') ? 1 : 0;
    localInput.steer = (codes.has('KeyA') ? 1 : 0) - (codes.has('KeyD') ? 1 : 0);
  };

  const onDown = (e: KeyboardEvent) => {
    codes.add(e.code);
    updateInput();
  };
  const onUp = (e: KeyboardEvent) => {
    codes.delete(e.code);
    updateInput();
  };

  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);

  // Cleanup function
  const cleanup = () => {
    window.removeEventListener('keydown', onDown);
    window.removeEventListener('keyup', onUp);
    remotePlayers.forEach((remote) => {
      remote.nameTag.dispose();
    });
  };

  window.addEventListener('beforeunload', cleanup);

  // Network: receive input from guests
  networkClient['callbacks'].onGuestMessage = (guestId: string, message) => {
    if (message.type === 'input') {
      const remote = remotePlayers.get(guestId);
      if (remote) {
        remote.lastInput = {
          throttle: message.throttle,
          brake: message.brake,
          steer: message.steer,
        };
      }
    }
  };

  loadingEl?.classList.add('hidden');

  // Show countdown before starting
  const countdown = new CountdownOverlay();
  countdown.show(3, () => {
    startGameLoop();
  });

  function startGameLoop() {
    const clock = new THREE.Clock();
    const cameraTarget = new THREE.Vector3();
    const cameraOffset = new THREE.Vector3(0, 4, 10);
    let elapsedTime = 0;
    let tickCounter = 0;
    const TICKS_PER_SNAPSHOT = Math.floor(TICK_RATE / SNAPSHOT_RATE);

    function loop() {
    const dt = Math.min(clock.getDelta(), 1 / 30);
    elapsedTime += dt;
    world.timestep = dt;

    // Update local player
    const onTrack = track.isOnTrack(localVehicle.rigidBody.translation());
    const gripMul = onTrack ? 1 : track.lapInfo.offTrackGripMultiplier;
    const drivingInput = {
      throttle: localInput.throttle * gripMul,
      brake: localInput.brake,
      steer: localInput.steer * gripMul,
    };

    localVehicle.update(drivingInput, dt);
    localLapTracker.update(dt);
    const localSpeedKmh = localVehicle.getSpeedKmh();
    const localForwardSpeedKmh = localVehicle.getForwardSpeedKmh();
    localArcDistance += (localForwardSpeedKmh / 3.6) * dt;

    // Update remote players
    remotePlayers.forEach((remote) => {
      const remoteOnTrack = track.isOnTrack(remote.vehicle.rigidBody.translation());
      const remoteGripMul = remoteOnTrack ? 1 : track.lapInfo.offTrackGripMultiplier;
      const remoteDrivingInput = {
        throttle: remote.lastInput.throttle * remoteGripMul,
        brake: remote.lastInput.brake,
        steer: remote.lastInput.steer * remoteGripMul,
      };

      remote.vehicle.update(remoteDrivingInput, dt);
      remote.lapTracker.update(dt);
      const remoteForwardSpeedKmh = remote.vehicle.getForwardSpeedKmh();
      remote.arcDistance += (remoteForwardSpeedKmh / 3.6) * dt;
    });

    world.step();
    localVehicle.syncVisuals();
    remotePlayers.forEach((remote) => {
      remote.vehicle.syncVisuals();
      remote.nameTag.updatePosition(remote.vehicle.chassisMesh.position);
    });

    // Broadcast snapshot to guests
    tickCounter++;
    if (tickCounter >= TICKS_PER_SNAPSHOT) {
      tickCounter = 0;
      broadcastSnapshot();
    }

    // Camera follows local player
    cameraTarget.copy(localVehicle.chassisMesh.position);
    const offsetWorld = cameraOffset.clone().applyQuaternion(localVehicle.chassisMesh.quaternion);
    camera.position.lerp(cameraTarget.clone().add(offsetWorld), 0.08);
    camera.lookAt(cameraTarget);

    // HUD for local player
    const localLapState = localLapTracker.state;
    const totalCars = 1 + remotePlayers.size;
    const playerPosition = calculatePosition(localPlayerId, localArcDistance);

    hud.update({
      speedKmh: localSpeedKmh,
      gear: estimateGear(localForwardSpeedKmh, localInput.throttle, localInput.brake),
      currentLap: Math.max(1, Math.min(totalLaps, localLapState.currentLap)),
      totalLaps,
      lapTimeMs: localLapState.currentLapTime * 1000,
      lastLapMs: Number.isFinite(localLapState.lastLapTime)
        ? localLapState.lastLapTime * 1000
        : null,
      bestLapMs: Number.isFinite(localLapState.bestLapTime)
        ? localLapState.bestLapTime * 1000
        : null,
      position: Math.max(1, Math.min(totalCars, playerPosition)),
      totalCars,
    });

    composer.setSpeed(localSpeedKmh);
    composer.render(dt);
    requestAnimationFrame(loop);
  }

  function calculatePosition(playerId: string, _arcDistance: number): number {
    const distances = [{ id: localPlayerId, distance: localArcDistance }];
    remotePlayers.forEach((remote) => {
      distances.push({ id: remote.id, distance: remote.arcDistance });
    });
    distances.sort((a, b) => b.distance - a.distance);
    return distances.findIndex((d) => d.id === playerId) + 1;
  }

  function broadcastSnapshot(): void {
    const players: PlayerSnapshot[] = [];

    // Local player
    const localPos = localVehicle.rigidBody.translation();
    const localRot = localVehicle.rigidBody.rotation();
    const localVel = localVehicle.rigidBody.linvel();
    const localLapState = localLapTracker.state;

    players.push({
      id: localPlayerId,
      name: playerNames.find((p) => p.id === localPlayerId)?.name || 'Host',
      position: [localPos.x, localPos.y, localPos.z],
      rotation: [localRot.x, localRot.y, localRot.z, localRot.w],
      velocity: [localVel.x, localVel.y, localVel.z],
      speedKmh: localVehicle.getSpeedKmh(),
      gear: estimateGear(
        localVehicle.getForwardSpeedKmh(),
        localInput.throttle,
        localInput.brake,
      ),
      currentLap: localLapState.currentLap,
      lapTimeMs: localLapState.currentLapTime * 1000,
      lastLapMs: Number.isFinite(localLapState.lastLapTime)
        ? localLapState.lastLapTime * 1000
        : null,
      bestLapMs: Number.isFinite(localLapState.bestLapTime)
        ? localLapState.bestLapTime * 1000
        : null,
    });

    // Remote players
    remotePlayers.forEach((remote) => {
      const pos = remote.vehicle.rigidBody.translation();
      const rot = remote.vehicle.rigidBody.rotation();
      const vel = remote.vehicle.rigidBody.linvel();
      const lapState = remote.lapTracker.state;

      players.push({
        id: remote.id,
        name: remote.name,
        position: [pos.x, pos.y, pos.z],
        rotation: [rot.x, rot.y, rot.z, rot.w],
        velocity: [vel.x, vel.y, vel.z],
        speedKmh: remote.vehicle.getSpeedKmh(),
        gear: estimateGear(
          remote.vehicle.getForwardSpeedKmh(),
          remote.lastInput.throttle,
          remote.lastInput.brake,
        ),
        currentLap: lapState.currentLap,
        lapTimeMs: lapState.currentLapTime * 1000,
        lastLapMs: Number.isFinite(lapState.lastLapTime) ? lapState.lastLapTime * 1000 : null,
        bestLapMs: Number.isFinite(lapState.bestLapTime) ? lapState.bestLapTime * 1000 : null,
      });
    });

    networkClient.broadcastToGuests({
      type: 'snapshot',
      tick: tickCounter,
      timestamp: performance.now(),
      players,
    });
  }

  requestAnimationFrame(loop);
  }
}
