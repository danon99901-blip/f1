import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { InputState } from '../input';

// --- F1-feel tuning constants -------------------------------------------------
// Chassis (sleek F1 silhouette: long, low, narrow). Half-extents.
const CHASSIS_HX = 0.9;   // half-width  (~1.8 m wide)
const CHASSIS_HY = 0.2;   // half-height (~0.4 m tall body)
const CHASSIS_HZ = 2.25;  // half-length (~4.5 m long)

// Center-of-mass offset (local space). Pushing it down massively stabilises
// the car at high speed and during cornering — this is THE planted-feel knob.
const COM_OFFSET_Y = -0.4;

// Wheels.
const WHEEL_RADIUS = 0.34;
const WHEEL_WIDTH = 0.32;
const WHEEL_Y_OFFSET = -0.15;          // wheel attachment height (relative to chassis center)
const WHEEL_HALF_TRACK = 0.85;         // distance from centerline to wheel center on X
const WHEEL_FRONT_Z = -1.55;           // forward wheels (negative Z = forward)
const WHEEL_REAR_Z = 1.55;             // rear wheels

const SUSPENSION_REST_LENGTH = 0.32;
const SUSPENSION_STIFFNESS = 55.0;     // firmer, otherwise downforce bottoms it out
const SUSPENSION_COMPRESSION = 6.5;    // damping on bumps
const SUSPENSION_RELAXATION = 6.0;     // rebound damping
const MAX_SUSPENSION_TRAVEL = 0.20;    // larger envelope so the chassis doesn't punch through
const MAX_SUSPENSION_FORCE = 100000;

const FRICTION_SLIP = 3.2;             // grip (2..4)
const SIDE_FRICTION_STIFFNESS = 1.0;

// Drive / brake / steering.
// We bypass Rapier's per-wheel engine force entirely (its sign convention
// flipped at speed in our setup, decelerating then reversing the car under
// full throttle). Instead we apply a direct horizontal thrust to the chassis
// along the visual nose direction. Tuning: 12000 N gives ~16 m/s² peak accel
// and a top speed around 70 m/s (~250 km/h) once balanced against drag and
// linear damping.
const THRUST_FORWARD_MAX = 12000;      // total thrust on chassis (forward)
const THRUST_REVERSE_MAX = 4500;       // total thrust on chassis (reverse)
const BRAKE_FRONT = 60;
const BRAKE_REAR = 90;                 // stronger rear brakes
const HANDBRAKE_REAR = 200;            // applied when no throttle and stationary-ish
const STEER_MAX = 0.55;                // ~31 degrees at low speed
const STEER_MIN = 0.12;                // at top speed
const STEER_SPEED_FALLOFF = 60;        // m/s where steering becomes minimal
const STEER_SMOOTH = 6.0;              // rad/s smoothing rate

// Speed cap (~85 m/s ≈ 306 km/h forward; reverse much lower).
const TOP_SPEED_FORWARD = 85;
const TOP_SPEED_REVERSE = 18;

const CHASSIS_LINEAR_DAMPING = 0.08;
const CHASSIS_ANGULAR_DAMPING = 1.6;   // resist over-rotation and oscillation

// --- Simple simulation layer (Stage 1) ---------------------------------------
// Tyre model: temperature + wear affect available grip.
const TYRE_AMBIENT_C = 72;
const TYRE_OPTIMAL_C = 95;
const TYRE_TEMP_GAIN_LAT = 0.9;
const TYRE_TEMP_GAIN_LONG = 0.6;
const TYRE_TEMP_COOLING = 0.07;
const TYRE_WEAR_RATE = 0.00002;

// Aero model: downforce and drag grow with v^2.
// Downforce is intentionally tame: too much pushes the suspension past its
// MAX_SUSPENSION_TRAVEL envelope at top speed, the chassis cuboid then sits
// directly on the trimesh and the wheel raycasts can lose the surface — the
// car appears to "sink through" the track. Keep aero/suspension headroom.
const DOWNFORCE_COEFF = 1.1;
const DOWNFORCE_MAX = 6000;
const DRAG_COEFF = 1.1;

// Wheel layout: 0=FL, 1=FR, 2=RL, 3=RR.
interface WheelDef {
  x: number;
  z: number;
  isFront: boolean;
  isLeft: boolean;
}

const WHEELS: WheelDef[] = [
  { x: -WHEEL_HALF_TRACK, z: WHEEL_FRONT_Z, isFront: true,  isLeft: true  },
  { x:  WHEEL_HALF_TRACK, z: WHEEL_FRONT_Z, isFront: true,  isLeft: false },
  { x: -WHEEL_HALF_TRACK, z: WHEEL_REAR_Z,  isFront: false, isLeft: true  },
  { x:  WHEEL_HALF_TRACK, z: WHEEL_REAR_Z,  isFront: false, isLeft: false },
];

export interface VehicleDebug {
  /** Signed longitudinal speed (m/s), Rapier convention flipped to "+ = forward". */
  forwardSpeed: number;
  /** Raw value from controller.currentVehicleSpeed() — before our sign flip. */
  rawVehicleSpeed: number;
  /** Engine force fed to rear wheels this tick (Rapier sign — negative = forward). */
  engineForce: number;
  brakeFront: number;
  brakeRear: number;
  smoothedSteer: number;
  wantsReverse: boolean;
  downforce: number;
  /** [FL, FR, RL, RR] — true if wheel raycast hit a surface this tick. */
  wheelContacts: boolean[];
  /** [FL, FR, RL, RR] — current suspension length (rest=SUSPENSION_REST_LENGTH). */
  suspensionLengths: number[];
  /** [FL, FR, RL, RR] — cumulative wheel spin angle in radians. */
  wheelRotations: number[];
  /** Yaw angle of the chassis (radians). */
  yaw: number;
  /** World-space direction the visual nose points (local -Z, applied rotation). */
  noseWorld: { x: number; y: number; z: number };
}

export interface Vehicle {
  rigidBody: RAPIER.RigidBody;
  controller: RAPIER.DynamicRayCastVehicleController;
  chassisMesh: THREE.Object3D;
  wheelMeshes: THREE.Object3D[];
  update(input: InputState, dt: number): void;
  syncVisuals(): void;
  /** Magnitude of the longitudinal speed, in km/h. */
  getSpeedKmh(): number;
  /** Signed longitudinal speed in km/h: positive forward, negative in reverse. */
  getForwardSpeedKmh(): number;
  /** Snapshot of the most recent update()'s control + contact state. */
  getDebug(): VehicleDebug;
}

function buildChassisMesh(): THREE.Group {
  const group = new THREE.Group();

  // Main tub (low, sleek body).
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xe10600,
    roughness: 0.35,
    metalness: 0.45,
  });
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(CHASSIS_HX * 2 * 0.7, CHASSIS_HY * 2, CHASSIS_HZ * 2),
    bodyMat,
  );
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Front nose cone.
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.18, 1.2),
    bodyMat,
  );
  nose.position.set(0, -0.05, -CHASSIS_HZ - 0.4);
  nose.castShadow = true;
  group.add(nose);

  // Front wing.
  const frontWing = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.06, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }),
  );
  frontWing.position.set(0, -0.18, -CHASSIS_HZ - 0.85);
  frontWing.castShadow = true;
  group.add(frontWing);

  // Rear wing.
  const rearWingMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
  const rearWing = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.35), rearWingMat);
  rearWing.position.set(0, 0.55, CHASSIS_HZ - 0.05);
  rearWing.castShadow = true;
  group.add(rearWing);

  const rearWingL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.35), rearWingMat);
  rearWingL.position.set(-0.65, 0.27, CHASSIS_HZ - 0.05);
  group.add(rearWingL);

  const rearWingR = rearWingL.clone();
  rearWingR.position.x = 0.65;
  group.add(rearWingR);

  // Cockpit bulge / halo proxy.
  const cockpit = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.28, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.4 }),
  );
  cockpit.position.set(0, CHASSIS_HY + 0.12, -0.1);
  cockpit.castShadow = true;
  group.add(cockpit);

  // Engine cover behind cockpit, tapered look via box.
  const engineCover = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.32, 1.4),
    bodyMat,
  );
  engineCover.position.set(0, CHASSIS_HY + 0.14, 0.9);
  engineCover.castShadow = true;
  group.add(engineCover);

  return group;
}

export function createCarModel(color: number): THREE.Group {
  const car = buildChassisMesh();
  for (const child of car.children) {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
      if (child.material.color.getHex() === 0xe10600) {
        child.material = child.material.clone();
        child.material.color.setHex(color);
      }
    }
  }

  for (const w of WHEELS) {
    const wheel = buildWheelMesh();
    wheel.position.set(
      w.x,
      WHEEL_Y_OFFSET - SUSPENSION_REST_LENGTH + WHEEL_RADIUS,
      w.z,
    );
    car.add(wheel);
  }
  return car;
}

function buildWheelMesh(): THREE.Object3D {
  // Cylinder oriented along X by default (after rotating Z->X).
  const geo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 24);
  geo.rotateZ(Math.PI / 2); // align cylinder axis with X (the axle)
  const mat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.85, metalness: 0.1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;

  // Rim accent.
  const rimGeo = new THREE.CylinderGeometry(WHEEL_RADIUS * 0.55, WHEEL_RADIUS * 0.55, WHEEL_WIDTH + 0.01, 16);
  rimGeo.rotateZ(Math.PI / 2);
  const rim = new THREE.Mesh(
    rimGeo,
    new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.4, metalness: 0.7 }),
  );
  mesh.add(rim);

  // Steering pivot wrapper so we can yaw front wheels independently of roll.
  const steerGroup = new THREE.Group();
  steerGroup.add(mesh);
  // Track the rolling mesh on the group for later access.
  (steerGroup as any).__rollMesh = mesh;
  return steerGroup;
}

export function createVehicle(world: RAPIER.World, scene: THREE.Scene): Vehicle {
  // --- Chassis rigid body ---------------------------------------------------
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, 1.2, 0)
    .setLinearDamping(CHASSIS_LINEAR_DAMPING)
    .setAngularDamping(CHASSIS_ANGULAR_DAMPING)
    .setCanSleep(false)
    // Continuous collision detection — at top speed the chassis covers ~1.4 m
    // per 60 fps step, enough to tunnel into thin trimesh edges without CCD.
    .setCcdEnabled(true);
  const rigidBody = world.createRigidBody(bodyDesc);

  // Chassis collider — set density so the car has real mass (~750 kg target).
  // Box volume = 1.8 * 0.4 * 4.5 = 3.24 m^3, density ~230 -> ~745 kg.
  const colliderDesc = RAPIER.ColliderDesc.cuboid(CHASSIS_HX, CHASSIS_HY, CHASSIS_HZ)
    .setDensity(230)
    .setFriction(0.5)
    .setRestitution(0.05);
  world.createCollider(colliderDesc, rigidBody);

  // Push center of mass downward for a planted feel. We use the existing
  // computed mass and inertia, then override center-of-mass via
  // setAdditionalMassProperties (this replaces — it does not add — when
  // collider mass is already present, but keeps the inertia tensor sensible).
  const mp = rigidBody.mass();
  // Approximate principal inertia of a solid cuboid: I = (m/12) * (a^2 + b^2)
  const m = mp;
  const w = CHASSIS_HX * 2;
  const h = CHASSIS_HY * 2;
  const l = CHASSIS_HZ * 2;
  const Ix = (m / 12) * (h * h + l * l);
  const Iy = (m / 12) * (w * w + l * l);
  const Iz = (m / 12) * (w * w + h * h);
  rigidBody.setAdditionalMassProperties(
    m,
    { x: 0, y: COM_OFFSET_Y, z: 0 },
    { x: Ix, y: Iy, z: Iz },
    { x: 0, y: 0, z: 0, w: 1 },
    true,
  );

  // --- Vehicle controller ---------------------------------------------------
  const controller = world.createVehicleController(rigidBody);
  controller.indexUpAxis = 1;          // Y is up
  controller.setIndexForwardAxis = 2;  // Z is forward (negative-Z is "front" of car visually)

  const suspensionDir = { x: 0, y: -1, z: 0 };
  const axleDir = { x: -1, y: 0, z: 0 };

  for (const w of WHEELS) {
    controller.addWheel(
      { x: w.x, y: WHEEL_Y_OFFSET, z: w.z },
      suspensionDir,
      axleDir,
      SUSPENSION_REST_LENGTH,
      WHEEL_RADIUS,
    );
  }

  for (let i = 0; i < WHEELS.length; i++) {
    controller.setWheelSuspensionStiffness(i, SUSPENSION_STIFFNESS);
    controller.setWheelSuspensionCompression(i, SUSPENSION_COMPRESSION);
    controller.setWheelSuspensionRelaxation(i, SUSPENSION_RELAXATION);
    controller.setWheelMaxSuspensionTravel(i, MAX_SUSPENSION_TRAVEL);
    controller.setWheelMaxSuspensionForce(i, MAX_SUSPENSION_FORCE);
    controller.setWheelFrictionSlip(i, FRICTION_SLIP);
    controller.setWheelSideFrictionStiffness(i, SIDE_FRICTION_STIFFNESS);
  }

  // --- Visuals --------------------------------------------------------------
  const chassisMesh = buildChassisMesh();
  scene.add(chassisMesh);

  const wheelMeshes: THREE.Object3D[] = [];
  for (let i = 0; i < WHEELS.length; i++) {
    const wm = buildWheelMesh();
    scene.add(wm);
    wheelMeshes.push(wm);
  }

  // --- Per-frame state ------------------------------------------------------
  let smoothedSteer = 0;
  const tyreTempC = [TYRE_AMBIENT_C, TYRE_AMBIENT_C, TYRE_AMBIENT_C, TYRE_AMBIENT_C];
  const tyreWear = [0, 0, 0, 0];
  const invChassisQ = new THREE.Quaternion();
  const worldVel = new THREE.Vector3();
  const localVel = new THREE.Vector3();
  const dragForce = new THREE.Vector3();

  // Debug snapshot — written at the end of update(), read by getDebug().
  const dbg: VehicleDebug = {
    forwardSpeed: 0,
    rawVehicleSpeed: 0,
    engineForce: 0,
    brakeFront: 0,
    brakeRear: 0,
    smoothedSteer: 0,
    wantsReverse: false,
    downforce: 0,
    wheelContacts: [false, false, false, false],
    suspensionLengths: [
      SUSPENSION_REST_LENGTH,
      SUSPENSION_REST_LENGTH,
      SUSPENSION_REST_LENGTH,
      SUSPENSION_REST_LENGTH,
    ],
    wheelRotations: [0, 0, 0, 0],
    yaw: 0,
    noseWorld: { x: 0, y: 0, z: -1 },
  };
  const tmpNose = new THREE.Vector3();
  const tmpChassisQ = new THREE.Quaternion();

  // Bump diagnostic: when suspension snaps shut by more than this in one tick,
  // we manually re-cast the wheel ray and print what was hit. Threshold chosen
  // so normal kerb/road bumps don't spam (typical step <0.05) but the mystery
  // bump from the logs (drop of ~0.17) does.
  const BUMP_DETECT_DELTA = 0.10;
  const WHEEL_LABELS = ['FL', 'FR', 'RL', 'RR'] as const;
  const wheelLocalConn = WHEELS.map(
    (w) => new THREE.Vector3(w.x, WHEEL_Y_OFFSET, w.z),
  );
  const diagRay = new RAPIER.Ray(
    { x: 0, y: 0, z: 0 },
    { x: 0, y: -1, z: 0 },
  );
  const diagOrigin = new THREE.Vector3();
  const diagChassisQ = new THREE.Quaternion();

  const tyreGripFactor = (tempC: number, wear01: number): number => {
    const tempDelta = Math.abs(tempC - TYRE_OPTIMAL_C);
    const tempFactor = Math.max(0.72, 1 - (tempDelta / 70) ** 1.35);
    const wearFactor = Math.max(0.65, 1 - wear01 * 0.45);
    return tempFactor * wearFactor;
  };

  function update(input: InputState, dt: number): void {
    // Rapier's addForce accumulates across world.step() calls until
    // resetForces() is called explicitly — there is no per-step auto-clear.
    // Without this reset, downforce/drag/thrust from prior frames pile up
    // every tick, the chassis then experiences forces orders of magnitude
    // larger than intended (we've measured ~5x within one second), the car
    // accelerates to 300 km/h and punches through the track. Reset first,
    // then add this frame's forces clean.
    rigidBody.resetForces(false);

    // Rapier vehicle speed sign is opposite to our visual convention
    // (car nose points toward -Z). Flip it so "forwardSpeed > 0" means
    // "moving toward the visual front of the car".
    const forwardSpeed = -controller.currentVehicleSpeed();
    const absSpeed = Math.abs(forwardSpeed);

    // Aerodynamic forces (very simplified): drag + downforce.
    worldVel.set(
      rigidBody.linvel().x,
      rigidBody.linvel().y,
      rigidBody.linvel().z,
    );
    // Use horizontal speed for aero so vertical bouncing (kerb hops, landings)
    // doesn't inject extra downforce that compounds the bottom-out.
    const horizSpeedSq = worldVel.x * worldVel.x + worldVel.z * worldVel.z;
    const speedMs = Math.sqrt(horizSpeedSq);
    const downforce = Math.min(DOWNFORCE_MAX, DOWNFORCE_COEFF * horizSpeedSq);
    rigidBody.addForce({ x: 0, y: -downforce, z: 0 }, true);

    if (speedMs > 1e-4) {
      dragForce
        .copy(worldVel)
        .normalize()
        .multiplyScalar(-DRAG_COEFF * horizSpeedSq);
      rigidBody.addForce({ x: dragForce.x, y: 0, z: dragForce.z }, true);
    }

    // Local-space velocities for slip/temperature estimation.
    const rbRot = rigidBody.rotation();
    invChassisQ.set(rbRot.x, rbRot.y, rbRot.z, rbRot.w).invert();
    localVel.copy(worldVel).applyQuaternion(invChassisQ);

    // Speed-sensitive steering: full lock at rest, narrow at top speed.
    const speedT = Math.min(absSpeed / STEER_SPEED_FALLOFF, 1);
    const steerLimit = STEER_MAX + (STEER_MIN - STEER_MAX) * speedT;
    const targetSteer = input.steer * steerLimit;
    // Exponential smoothing for natural rack feel.
    const k = 1 - Math.exp(-STEER_SMOOTH * dt);
    smoothedSteer += (targetSteer - smoothedSteer) * k;

    // Throttle / brake / engine logic.
    //
    // S (brake) is dual-use: while moving forward it brakes; once the car has
    // come to a near-stop and brake is still held with no throttle, it
    // engages reverse. This matches the arcade convention and keeps the input
    // surface to two pedals plus steering.
    const throttle = input.throttle;
    const brake = input.brake;
    const wantsReverse = brake > 0 && throttle === 0 && forwardSpeed < 1.0;

    // engineForce is now a SIGNED thrust scalar in newtons applied directly
    // to the chassis: positive = toward the visual nose, negative = away.
    let engineForce = 0;
    if (throttle > 0) {
      if (forwardSpeed < TOP_SPEED_FORWARD) {
        const headroom = 1 - Math.max(forwardSpeed, 0) / TOP_SPEED_FORWARD;
        engineForce = THRUST_FORWARD_MAX * throttle * headroom;
      }
    } else if (wantsReverse) {
      if (-forwardSpeed < TOP_SPEED_REVERSE) {
        const headroom = 1 - Math.max(-forwardSpeed, 0) / TOP_SPEED_REVERSE;
        engineForce = -THRUST_REVERSE_MAX * brake * headroom;
      }
    }

    // Apply the thrust as a horizontal force on the chassis along the nose
    // direction. We zero the y-component so engine power never lifts/pulls
    // the car vertically when the chassis pitches. Brakes still go through
    // the wheels (Rapier handles them correctly).
    if (engineForce !== 0) {
      const r = rigidBody.rotation();
      tmpChassisQ.set(r.x, r.y, r.z, r.w);
      tmpNose.set(0, 0, -1).applyQuaternion(tmpChassisQ);
      rigidBody.addForce(
        {
          x: tmpNose.x * engineForce,
          y: 0,
          z: tmpNose.z * engineForce,
        },
        true,
      );
    }

    // Brake force per axle. Active only when S is held and we're NOT in
    // reverse mode (otherwise brakes would fight the reverse engine force).
    let brakeFront = 0;
    let brakeRear = 0;
    if (brake > 0 && !wantsReverse) {
      brakeFront = BRAKE_FRONT * brake;
      brakeRear = BRAKE_REAR * brake;
    } else if (throttle === 0 && brake === 0 && absSpeed < 0.5) {
      // Soft handbrake to keep the car still on slopes/at rest.
      brakeRear = HANDBRAKE_REAR * 0.05;
    }

    for (let i = 0; i < WHEELS.length; i++) {
      const w = WHEELS[i];
      if (!w) continue;
      const steer = w.isFront ? smoothedSteer : 0;

      // Approximate wheel-frame speeds.
      const cosS = Math.cos(steer);
      const sinS = Math.sin(steer);
      const wheelLong = -localVel.z * cosS + localVel.x * sinS;
      const wheelLat = localVel.x * cosS + localVel.z * sinS;

      // Slip proxies — used only for the thermal/wear model, not by physics.
      const longSlip = Math.abs(engineForce) > 1
        ? Math.min(Math.abs(engineForce) / THRUST_FORWARD_MAX, 1)
        : Math.min(Math.abs(brakeRear + brakeFront) / BRAKE_REAR, 1);
      const latSlip = Math.min(Math.abs(wheelLat) / Math.max(Math.abs(wheelLong), 4), 1.6);

      // Tyre temperature and wear updates.
      const heatGain =
        TYRE_TEMP_GAIN_LAT * Math.abs(wheelLat) +
        TYRE_TEMP_GAIN_LONG * longSlip * Math.abs(wheelLong);
      const cooling = (tyreTempC[i]! - TYRE_AMBIENT_C) * TYRE_TEMP_COOLING;
      tyreTempC[i] = Math.max(
        TYRE_AMBIENT_C - 5,
        Math.min(165, tyreTempC[i]! + (heatGain - cooling) * dt),
      );

      const wearGain = TYRE_WEAR_RATE * (latSlip * latSlip + longSlip * longSlip) * (1 + absSpeed / 65);
      tyreWear[i] = Math.min(1, tyreWear[i]! + wearGain * dt * 60);

      // Grip scales with aero, temperature and wear. Divisor rescaled when we
      // dropped DOWNFORCE_MAX from 14000 to 6000 so top-speed grip still
      // feels noticeably more planted than at low speed.
      const aeroGripFactor = 1 + Math.min(0.5, downforce / 12000);
      const tyreFactor = tyreGripFactor(tyreTempC[i]!, tyreWear[i]!);
      const wheelGrip = FRICTION_SLIP * tyreFactor * aeroGripFactor;

      // No per-wheel engine force — propulsion is now a chassis-level thrust
      // applied above. Keep this at zero so Rapier doesn't carry over a stale
      // value from a previous tick.
      controller.setWheelEngineForce(i, 0);
      // Steering on front wheels.
      controller.setWheelSteering(i, steer);
      // Brakes everywhere, biased to rear.
      controller.setWheelBrake(i, w.isFront ? brakeFront : brakeRear);
      controller.setWheelFrictionSlip(i, wheelGrip);
      controller.setWheelSideFrictionStiffness(
        i,
        SIDE_FRICTION_STIFFNESS * Math.min(1.3, 0.9 + 0.25 * tyreFactor),
      );
    }

    // Vehicle controller integration: applies wheel forces to the chassis.
    // Call this BEFORE world.step() each frame.
    //
    // Filter the wheel raycasts so they only see the road and barriers, never
    // AI cars (kinematic) or checkpoint sensors. Without this, a wheel ray
    // can hit an opponent's chassis underside as the player closes the gap,
    // and the suspension snaps to its minimum because the "ground" suddenly
    // appears 0.3-0.4 m above the asphalt.
    controller.updateVehicle(
      dt,
      RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC |
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    );

    // Bump diagnostic — runs BEFORE we overwrite dbg.suspensionLengths so
    // the prev-frame value is still in dbg.suspensionLengths[i].
    {
      const ct = rigidBody.translation();
      const cr = rigidBody.rotation();
      diagChassisQ.set(cr.x, cr.y, cr.z, cr.w);
      for (let i = 0; i < WHEELS.length; i++) {
        const prevLen = dbg.suspensionLengths[i] ?? SUSPENSION_REST_LENGTH;
        const currLen = controller.wheelSuspensionLength(i) ?? SUSPENSION_REST_LENGTH;
        if (prevLen - currLen <= BUMP_DETECT_DELTA) continue;

        diagOrigin.copy(wheelLocalConn[i]!).applyQuaternion(diagChassisQ);
        diagOrigin.x += ct.x;
        diagOrigin.y += ct.y;
        diagOrigin.z += ct.z;
        diagRay.origin.x = diagOrigin.x;
        diagRay.origin.y = diagOrigin.y;
        diagRay.origin.z = diagOrigin.z;
        const maxToi = SUSPENSION_REST_LENGTH + WHEEL_RADIUS;
        const hit = world.castRayAndGetNormal(
          diagRay,
          maxToi,
          true,
          undefined,
          undefined,
          undefined,
          rigidBody,
        );
        const lbl = WHEEL_LABELS[i];
        if (hit) {
          const hitY = diagOrigin.y + diagRay.dir.y * hit.timeOfImpact;
          console.warn(
            `[bump] ${lbl} susp ${prevLen.toFixed(3)}->${currLen.toFixed(3)} ` +
              `origin=(${diagOrigin.x.toFixed(2)},${diagOrigin.y.toFixed(2)},${diagOrigin.z.toFixed(2)}) ` +
              `hit y=${hitY.toFixed(3)} dist=${hit.timeOfImpact.toFixed(3)} ` +
              `colliderHandle=${hit.collider.handle} ` +
              `normal=(${hit.normal.x.toFixed(2)},${hit.normal.y.toFixed(2)},${hit.normal.z.toFixed(2)})`,
          );
        } else {
          console.warn(
            `[bump] ${lbl} susp ${prevLen.toFixed(3)}->${currLen.toFixed(3)} ` +
              `but diagnostic ray missed everything within ${maxToi}m`,
          );
        }
      }
    }

    // Debug snapshot for the diagnostic logger in main.ts.
    dbg.forwardSpeed = forwardSpeed;
    dbg.rawVehicleSpeed = controller.currentVehicleSpeed();
    dbg.engineForce = engineForce;
    dbg.brakeFront = brakeFront;
    dbg.brakeRear = brakeRear;
    dbg.smoothedSteer = smoothedSteer;
    dbg.wantsReverse = wantsReverse;
    dbg.downforce = downforce;
    for (let i = 0; i < WHEELS.length; i++) {
      dbg.wheelContacts[i] = controller.wheelIsInContact(i) ?? false;
      dbg.suspensionLengths[i] =
        controller.wheelSuspensionLength(i) ?? SUSPENSION_REST_LENGTH;
      dbg.wheelRotations[i] = controller.wheelRotation(i) ?? 0;
    }
    const r = rigidBody.rotation();
    tmpChassisQ.set(r.x, r.y, r.z, r.w);
    // Yaw extracted from quaternion around Y. Equivalent to atan2(2(wy+xz), 1-2(y²+x²)).
    dbg.yaw = Math.atan2(
      2 * (r.w * r.y + r.x * r.z),
      1 - 2 * (r.y * r.y + r.x * r.x),
    );
    // World-space direction of the visual nose (local -Z transformed by chassis rotation).
    tmpNose.set(0, 0, -1).applyQuaternion(tmpChassisQ);
    dbg.noseWorld.x = tmpNose.x;
    dbg.noseWorld.y = tmpNose.y;
    dbg.noseWorld.z = tmpNose.z;
  }

  function syncVisuals(): void {
    const t = rigidBody.translation();
    const r = rigidBody.rotation();
    chassisMesh.position.set(t.x, t.y, t.z);
    chassisMesh.quaternion.set(r.x, r.y, r.z, r.w);

    for (let i = 0; i < WHEELS.length; i++) {
      const wheelGroup = wheelMeshes[i];
      if (!wheelGroup) continue;
      const conn = controller.wheelChassisConnectionPointCs(i);
      const dirCs = controller.wheelDirectionCs(i);
      const suspLen = controller.wheelSuspensionLength(i) ?? SUSPENSION_REST_LENGTH;
      if (!conn || !dirCs) continue;

      const localPos = new THREE.Vector3(
        conn.x + dirCs.x * suspLen,
        conn.y + dirCs.y * suspLen,
        conn.z + dirCs.z * suspLen,
      );
      localPos.applyQuaternion(chassisMesh.quaternion);
      wheelGroup.position.copy(chassisMesh.position).add(localPos);

      const steerQ = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        controller.wheelSteering(i) ?? 0,
      );
      wheelGroup.quaternion.copy(chassisMesh.quaternion).multiply(steerQ);

      const rollMesh = (wheelGroup as { __rollMesh?: THREE.Mesh }).__rollMesh;
      if (rollMesh) {
        const rot = controller.wheelRotation(i) ?? 0;
        rollMesh.rotation.x = rot;
      }
    }
  }

  function getSpeedKmh(): number {
    return Math.abs(controller.currentVehicleSpeed()) * 3.6;
  }

  function getForwardSpeedKmh(): number {
    // Rapier's vehicle speed has the opposite sign to our visual forward
    // (the car nose points toward -Z), so flip it before returning.
    return -controller.currentVehicleSpeed() * 3.6;
  }

  return {
    rigidBody,
    controller,
    chassisMesh,
    wheelMeshes,
    update,
    syncVisuals,
    getSpeedKmh,
    getForwardSpeedKmh,
    getDebug: () => dbg,
  };
}
