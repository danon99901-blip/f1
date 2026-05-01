import * as THREE from 'three';
import { initPhysics, RAPIER } from './physics';
import { createScene, createGround } from './scene';
import { createInput } from './input';
import { createVehicle } from './car/vehicle';
import { createTrack } from './track/track';
import { createLapTracker } from './track/lap';
import { createHud, type Gear } from './hud/hud';
import { createComposer } from './effects/composer';
import { createOpponents } from './ai/opponents';
import './hud/styles.css';

const TOTAL_LAPS = 10;

function estimateGear(speedKmh: number, throttle: number): Gear {
  if (speedKmh < 1 && throttle === 0) return 'N';
  if (throttle < 0 && speedKmh < 20) return 'R';
  return Math.max(1, Math.min(8, Math.floor(speedKmh / 40) + 1));
}

async function main() {
  const appEl = document.getElementById('app');
  const loadingEl = document.getElementById('loading');
  if (!appEl) throw new Error('#app not found');

  const hud = createHud();
  document.body.appendChild(hud.root);

  const world = await initPhysics();
  const { scene, camera, renderer } = createScene(appEl);
  const composer = createComposer(renderer, scene, camera);
  createGround(scene);

  // Keep off-track ground below the asphalt/trimesh to avoid wheel raycast
  // switching between nearly coplanar surfaces (feels like curb chatter).
  const groundCollider = RAPIER.ColliderDesc.cuboid(400, 0.1, 400).setTranslation(0, -0.35, 0);
  world.createCollider(groundCollider);

  const track = createTrack(world, scene);
  const vehicle = createVehicle(world, scene);
  const spawn = track.lapInfo.spawn;
  const yawSpawn = Math.atan2(-spawn.forward.x, -spawn.forward.z);
  vehicle.rigidBody.setTranslation(spawn.position, true);
  vehicle.rigidBody.setRotation(
    { x: 0, y: Math.sin(yawSpawn / 2), z: 0, w: Math.cos(yawSpawn / 2) },
    true,
  );
  const lapTracker = createLapTracker(track, vehicle.rigidBody, world);
  const playerStartProgress = track.getProgress(spawn.position);
  const opponents = createOpponents(scene, world, track.lapInfo.length, playerStartProgress, 5);

  const input = createInput();
  const drivingInput = { forward: 0, brake: 0, steer: 0 };

  loadingEl?.classList.add('hidden');

  const clock = new THREE.Clock();
  const cameraTarget = new THREE.Vector3();
  const cameraOffset = new THREE.Vector3(0, 4, 10);
  let elapsedTime = 0;
  let belowTrackTimer = 0;

  const respawnAtGrid = () => {
    vehicle.rigidBody.setTranslation(spawn.position, true);
    vehicle.rigidBody.setRotation(
      { x: 0, y: Math.sin(yawSpawn / 2), z: 0, w: Math.cos(yawSpawn / 2) },
      true,
    );
    vehicle.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    vehicle.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    belowTrackTimer = 0;
  };

  function loop() {
    const dt = Math.min(clock.getDelta(), 1 / 30);
    elapsedTime += dt;
    world.timestep = dt;

    // Safety recovery:
    // 1) hard fall below world
    // 2) "half-fall" below track level for too long (stuck in geometry)
    const y = vehicle.rigidBody.translation().y;
    if (!Number.isFinite(y) || y < -1.2) {
      respawnAtGrid();
    } else if (y < 0.28) {
      belowTrackTimer += dt;
      if (belowTrackTimer > 0.35) respawnAtGrid();
    } else {
      belowTrackTimer = 0;
    }

    const onTrack = track.isOnTrack(vehicle.rigidBody.translation());
    const gripMul = onTrack ? 1 : track.lapInfo.offTrackGripMultiplier;
    drivingInput.forward = input.state.forward * gripMul;
    drivingInput.brake = input.state.brake;
    drivingInput.steer = input.state.steer * gripMul;

    vehicle.update(drivingInput, dt);
    world.step();
    vehicle.syncVisuals();
    lapTracker.update(dt);
    const speedKmh = vehicle.getSpeedKmh();
    opponents.update(dt, elapsedTime, speedKmh);
    opponents.handlePlayerImpacts(vehicle.rigidBody);

    cameraTarget.copy(vehicle.chassisMesh.position);
    const offsetWorld = cameraOffset.clone().applyQuaternion(vehicle.chassisMesh.quaternion);
    camera.position.lerp(cameraTarget.clone().add(offsetWorld), 0.08);
    camera.lookAt(cameraTarget);

    const lapState = lapTracker.state;
    const totalCars = opponents.getTotalCars();
    const playerPosition = opponents.getPlayerPosition(lapState.currentLap, lapState.position);
    hud.update({
      speedKmh,
      gear: estimateGear(speedKmh, input.state.forward),
      currentLap: Math.max(1, Math.min(TOTAL_LAPS, lapState.currentLap)),
      totalLaps: TOTAL_LAPS,
      lapTimeMs: lapState.currentLapTime * 1000,
      lastLapMs: Number.isFinite(lapState.lastLapTime) ? lapState.lastLapTime * 1000 : null,
      bestLapMs: Number.isFinite(lapState.bestLapTime) ? lapState.bestLapTime * 1000 : null,
      position: Math.max(1, Math.min(totalCars, playerPosition)),
      totalCars,
    });

    composer.setSpeed(speedKmh);
    composer.render(dt);
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = 'ERROR — see console';
});
