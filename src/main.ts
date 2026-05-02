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

function estimateGear(forwardSpeedKmh: number, throttle: number, brake: number): Gear {
  const abs = Math.abs(forwardSpeedKmh);
  if (abs < 1 && throttle === 0 && brake === 0) return 'N';
  if (forwardSpeedKmh < -1) return 'R';
  return Math.max(1, Math.min(8, Math.floor(abs / 40) + 1));
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
  const playerStartArcDistance = playerStartProgress * track.lapInfo.length;
  const opponents = createOpponents(scene, world, track.lapInfo.length, playerStartProgress, 5);

  const input = createInput();
  const drivingInput = { throttle: 0, brake: 0, steer: 0 };

  loadingEl?.classList.add('hidden');

  const clock = new THREE.Clock();
  const cameraTarget = new THREE.Vector3();
  const cameraOffset = new THREE.Vector3(0, 4, 10);
  let elapsedTime = 0;
  let belowTrackTimer = 0;

  // --- Debug logging ---------------------------------------------------------
  // Toggle off by setting DEBUG = false. Periodic line at 10 Hz with the full
  // control + physics snapshot, plus immediate event prints when ground
  // contact, reverse-mode, on-track or respawn state changes.
  const DEBUG = true;
  const LOG_INTERVAL_S = 0.1;
  let logTimer = 0;
  let prevWantsReverse = false;
  let prevOnTrack = true;
  const prevContacts = [true, true, true, true];
  let prevVx = 0;
  let prevVz = 0;
  const fmt = (n: number, d = 2) => n.toFixed(d);
  // Cumulative arc length for the player along the centerline. Same units as
  // the opponents' `distance` field, so getPlayerPosition can compare them
  // directly without any lap-counter arithmetic. Reset on respawn so a
  // recovery doesn't credit you with extra ground.
  let playerArcDistance = playerStartArcDistance;

  const respawnAtGrid = (reason: string) => {
    if (DEBUG) {
      const t = vehicle.rigidBody.translation();
      console.warn(
        `[respawn] reason=${reason} at y=${fmt(t.y, 3)} t=${fmt(elapsedTime)}s`,
      );
    }
    vehicle.rigidBody.setTranslation(spawn.position, true);
    vehicle.rigidBody.setRotation(
      { x: 0, y: Math.sin(yawSpawn / 2), z: 0, w: Math.cos(yawSpawn / 2) },
      true,
    );
    vehicle.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    vehicle.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    belowTrackTimer = 0;
    playerArcDistance = playerStartArcDistance;
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
      respawnAtGrid('hard-fall');
    } else if (y < 0.28) {
      belowTrackTimer += dt;
      if (belowTrackTimer > 0.35) respawnAtGrid('below-track');
    } else {
      belowTrackTimer = 0;
    }

    const onTrack = track.isOnTrack(vehicle.rigidBody.translation());
    const gripMul = onTrack ? 1 : track.lapInfo.offTrackGripMultiplier;
    // Throttle and steering get the off-track grip penalty; brakes don't —
    // we want the player to always be able to scrub speed to recover.
    drivingInput.throttle = input.state.throttle * gripMul;
    drivingInput.brake = input.state.brake;
    drivingInput.steer = input.state.steer * gripMul;

    vehicle.update(drivingInput, dt);
    world.step();
    vehicle.syncVisuals();
    lapTracker.update(dt);
    const speedKmh = vehicle.getSpeedKmh();
    const forwardSpeedKmh = vehicle.getForwardSpeedKmh();
    playerArcDistance += (forwardSpeedKmh / 3.6) * dt;

    if (DEBUG) {
      const dbg = vehicle.getDebug();

      if (dbg.wantsReverse !== prevWantsReverse) {
        console.log(
          `[event] wantsReverse=${dbg.wantsReverse} fwd=${fmt(dbg.forwardSpeed)}m/s thr=${input.state.throttle} brk=${input.state.brake}`,
        );
        prevWantsReverse = dbg.wantsReverse;
      }
      if (onTrack !== prevOnTrack) {
        console.log(`[event] onTrack=${onTrack}`);
        prevOnTrack = onTrack;
      }
      for (let i = 0; i < 4; i++) {
        if (dbg.wheelContacts[i] !== prevContacts[i]) {
          const labels = ['FL', 'FR', 'RL', 'RR'];
          console.log(
            `[event] wheel ${labels[i]} contact=${dbg.wheelContacts[i]} susp=${fmt(dbg.suspensionLengths[i] ?? 0, 3)}`,
          );
          prevContacts[i] = dbg.wheelContacts[i] ?? false;
        }
      }

      logTimer += dt;
      if (logTimer >= LOG_INTERVAL_S) {
        logTimer = 0;
        const t = vehicle.rigidBody.translation();
        const v = vehicle.rigidBody.linvel();
        const contacts = dbg.wheelContacts.map((c) => (c ? '1' : '0')).join('');
        const susp = dbg.suspensionLengths
          .map((l) => fmt(l, 2))
          .join(',');
        // World-frame acceleration (finite difference against previous log tick).
        const ax = (v.x - prevVx) / Math.max(LOG_INTERVAL_S, 1e-6);
        const az = (v.z - prevVz) / Math.max(LOG_INTERVAL_S, 1e-6);
        prevVx = v.x;
        prevVz = v.z;
        // Velocity component along the visual nose direction. Should equal
        // forwardSpeed if everything is consistent. If they disagree, the car
        // is "going forward sideways" — strong sign the chassis rotated.
        const noseDotVel =
          dbg.noseWorld.x * v.x + dbg.noseWorld.z * v.z;
        const yawDeg = (dbg.yaw * 180) / Math.PI;
        // Rear-wheel angular velocity proxy — diff of cumulative wheel angle.
        // Useful to spot wheelspin (high w*r vs low ground speed) or wheels
        // turning in the wrong direction.
        const rlOmega = dbg.wheelRotations[2] ?? 0;
        const rrOmega = dbg.wheelRotations[3] ?? 0;
        console.log(
          `[t=${fmt(elapsedTime)}] ` +
            `in(W=${input.state.throttle} S=${input.state.brake} A/D=${fmt(input.state.steer)}) ` +
            `drv(T=${fmt(drivingInput.throttle)} B=${fmt(drivingInput.brake)}) ` +
            `onTrack=${onTrack} ` +
            `pos.y=${fmt(t.y, 3)} vel=(${fmt(v.x, 1)},${fmt(v.y, 1)},${fmt(v.z, 1)}) ` +
            `acc.xz=(${fmt(ax, 1)},${fmt(az, 1)}) ` +
            `fwd=${fmt(dbg.forwardSpeed)}m/s rawVS=${fmt(dbg.rawVehicleSpeed)} ` +
            `nose·vel=${fmt(noseDotVel)} ` +
            `yaw=${fmt(yawDeg, 0)}° nose=(${fmt(dbg.noseWorld.x, 2)},${fmt(dbg.noseWorld.z, 2)}) ` +
            `eng=${fmt(dbg.engineForce, 0)} brk=F${fmt(dbg.brakeFront, 0)}/R${fmt(dbg.brakeRear, 0)} ` +
            `rev=${dbg.wantsReverse} df=${fmt(dbg.downforce, 0)} ` +
            `contacts=${contacts} susp=[${susp}] ` +
            `wRL=${fmt(rlOmega, 1)} wRR=${fmt(rrOmega, 1)}`,
        );
      }
    }
    opponents.update(dt, elapsedTime, speedKmh);
    opponents.handlePlayerImpacts(vehicle.rigidBody);

    cameraTarget.copy(vehicle.chassisMesh.position);
    const offsetWorld = cameraOffset.clone().applyQuaternion(vehicle.chassisMesh.quaternion);
    camera.position.lerp(cameraTarget.clone().add(offsetWorld), 0.08);
    camera.lookAt(cameraTarget);

    const lapState = lapTracker.state;
    const totalCars = opponents.getTotalCars();
    const playerPosition = opponents.getPlayerPosition(playerArcDistance);
    hud.update({
      speedKmh,
      gear: estimateGear(forwardSpeedKmh, input.state.throttle, input.state.brake),
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
