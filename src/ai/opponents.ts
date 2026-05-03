import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { RAPIER as RAPIER_NS } from '../physics';
import { createCarModel } from '../car/vehicle';
import { buildRacingLine } from './racingLine';
import { expDecayBlend, tangentToYaw } from '../utils/math';

interface Opponent {
  mesh: THREE.Group;
  body: RAPIER.RigidBody | null;
  collider: RAPIER.Collider | null;
  distance: number;
  /** Skill multiplier on the planned cornering speed (0.85–1.02). */
  skill: number;
  /** Top-speed multiplier on straights (0.92–1.0). */
  straightLineSkill: number;
  /** Smoothed instantaneous speed (m/s); we accelerate/brake toward target. */
  speedMs: number;
  /** Smoothed lateral offset, lerped toward the racing line. */
  laneOffset: number;
  /** Current heading direction (used for impact-velocity calc). */
  tangent: THREE.Vector3;
  /** Phase for low-amplitude throttle wave so packs don't be lockstep. */
  pacePhase: number;
  /** 0–1: how willing this driver is to commit to overtakes (vs. tucking in). */
  aggression: number;
  /** Smoothed 0–1 commit weight blending racing-line vs. overtake-line. */
  overtakeCommit: number;
  /** Brief speed-loss event: positive = active, ticks down each frame. */
  mistakeTimer: number;
  /** Cooldown until the AI is allowed to roll a new mistake. */
  mistakeCooldown: number;
  destroyed: boolean;
  hitCooldown: number;
}

interface DebrisPiece {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  life: number;
}

export interface OpponentsController {
  update: (dt: number, elapsedTime: number, playerSpeedKmh: number) => void;
  handlePlayerImpacts: (playerBody: RAPIER.RigidBody) => number;
  /** Rank the player among the field. `playerArcDistance` is cumulative arc
   *  length along the centerline, in metres, in the same coordinate system
   *  as `opponent.distance` (i.e. it grows monotonically and can exceed
   *  `trackLength` after laps). */
  getPlayerPosition: (playerArcDistance: number) => number;
  getTotalCars: () => number;
}

const OPPONENT_HALF = { x: 0.95, y: 0.35, z: 2.45 };
const IMPACT_DESTROY_SPEED = 18; // m/s relative along impact normal

export function createOpponents(
  scene: THREE.Scene,
  world: RAPIER.World,
  trackLength: number,
  playerStartProgress: number,
  count = 5,
): OpponentsController {
  const racingLine = buildRacingLine();
  const opponents: Opponent[] = [];
  const debris: DebrisPiece[] = [];
  const palette = [0x0066ff, 0xff9f1a, 0x7c4dff, 0x20bf55, 0xff3366];
  const playerStartDistance = playerStartProgress * trackLength;
  const gridGap = 8.5;

  for (let i = 0; i < count; i++) {
    const mesh = createCarModel(palette[i % palette.length]!);
    scene.add(mesh);

    const body = world.createRigidBody(
      RAPIER_NS.RigidBodyDesc.kinematicPositionBased().setCanSleep(false),
    );
    const collider = world.createCollider(
      RAPIER_NS.ColliderDesc.cuboid(OPPONENT_HALF.x, OPPONENT_HALF.y, OPPONENT_HALF.z)
        .setFriction(0.9)
        .setRestitution(0.05),
      body,
    );

    const row = Math.floor(i / 2);
    const side = i % 2 === 0 ? -1 : 1;
    const distance = playerStartDistance + (row + 1) * gridGap;
    // Spread skill along the grid: front rows are quicker. Small random jitter
    // so identical rows still differ frame-to-frame.
    const skill = 0.88 + (count - i) / count * 0.14 + (Math.random() - 0.5) * 0.03;
    const straightLineSkill = 0.85 + (count - i) / count * 0.15;
    opponents.push({
      mesh,
      body,
      collider,
      distance,
      skill,
      straightLineSkill,
      speedMs: 0,
      laneOffset: side * 1.5,
      tangent: new THREE.Vector3(0, 0, -1),
      pacePhase: i * 0.8 + Math.random() * 1.5,
      aggression: 0.4 + Math.random() * 0.5,
      overtakeCommit: 0,
      mistakeTimer: 0,
      mistakeCooldown: 12 + Math.random() * 18,
      destroyed: false,
      hitCooldown: 0,
    });
  }

  const up = new THREE.Vector3(0, 1, 0);
  const tmpNormal = new THREE.Vector3();
  const tmpPlayerVel = new THREE.Vector3();
  const tmpOppVel = new THREE.Vector3();
  const tmpRelVel = new THREE.Vector3();
  function spawnDebris(opponent: Opponent, impactNormal: THREE.Vector3, impactSpeed: number): void {
    opponent.mesh.updateMatrixWorld(true);
    const color = (
      opponent.mesh.children[0] instanceof THREE.Mesh &&
      opponent.mesh.children[0].material instanceof THREE.MeshStandardMaterial
    )
      ? opponent.mesh.children[0].material.color.getHex()
      : 0x888888;

    for (let i = 0; i < 9; i++) {
      const size = 0.18 + Math.random() * 0.22;
      const piece = new THREE.Mesh(
        new THREE.BoxGeometry(size * 1.6, size, size * 2.2),
        new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2 }),
      );
      piece.castShadow = true;
      piece.receiveShadow = true;

      piece.position.copy(opponent.mesh.position).add(new THREE.Vector3(
        (Math.random() - 0.5) * 1.8,
        0.2 + Math.random() * 0.8,
        (Math.random() - 0.5) * 2.5,
      ));
      scene.add(piece);

      const blast = 8 + impactSpeed * 0.35;
      const velocity = impactNormal.clone().multiplyScalar(blast).add(new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        4 + Math.random() * 4,
        (Math.random() - 0.5) * 5,
      ));
      const angularVelocity = new THREE.Vector3(
        (Math.random() - 0.5) * 9,
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 9,
      );
      debris.push({ mesh: piece, velocity, angularVelocity, life: 3.5 + Math.random() * 1.2 });
    }
  }

  function destroyOpponent(opponent: Opponent, impactNormal: THREE.Vector3, impactSpeed: number): void {
    if (opponent.destroyed) return;
    opponent.destroyed = true;
    opponent.mesh.visible = false;
    if (opponent.collider) {
      world.removeCollider(opponent.collider, false);
      opponent.collider = null;
    }
    if (opponent.body) {
      world.removeRigidBody(opponent.body);
      opponent.body = null;
    }
    spawnDebris(opponent, impactNormal, impactSpeed);
  }

  // How quickly an AI car accelerates to / decelerates toward target speed.
  const ACCEL = 9.0;
  const DECEL = 26.0;
  const OFFSET_LERP = 3.5;
  // Look-ahead distance (m) so we start braking *before* the corner.
  const LOOKAHEAD_M = 55;
  // Width of the asphalt minus a safety strip — clamp for traffic shifts.
  const OFFSET_LIMIT = 7.5;
  // Longitudinal trigger distances for traffic logic.
  const FOLLOW_TRIGGER = 22; // metres ahead — start reacting
  const SAFE_GAP = 8;        // close enough we must match speed if blocked

  // Per-frame plan scratch — index aligned with `opponents`.
  const planTargetSpeed = new Array<number>(opponents.length).fill(0);
  const planTargetOffset = new Array<number>(opponents.length).fill(0);

  /** Shortest signed gap from `from` to `to` along the closed track,
   *  positive = `to` is ahead. */
  function lapGap(from: number, to: number): number {
    let g = (to - from) % trackLength;
    if (g < -trackLength / 2) g += trackLength;
    if (g > trackLength / 2) g -= trackLength;
    return g;
  }

  function update(dt: number, elapsedTime: number, _playerSpeedKmh: number): void {
    void _playerSpeedKmh;

    const commitBlend = expDecayBlend(4.0, dt);
    const offsetBlend = expDecayBlend(OFFSET_LERP, dt);

    // Phase 1 — plan: racing-line targets, mistakes, idle bookkeeping.
    for (let i = 0; i < opponents.length; i++) {
      const opponent = opponents[i]!;
      opponent.hitCooldown = Math.max(0, opponent.hitCooldown - dt);
      if (opponent.destroyed || !opponent.body) continue;

      const here = racingLine.query(opponent.distance);
      const ahead = racingLine.query(opponent.distance + LOOKAHEAD_M);
      const planSpeed = Math.min(here.speed, ahead.speed) * opponent.skill;
      const paceWave = 1 + Math.sin(elapsedTime * 0.4 + opponent.pacePhase) * 0.025;
      let targetSpeed = Math.min(planSpeed * paceWave, 80 * opponent.straightLineSkill);

      opponent.mistakeCooldown -= dt;
      if (opponent.mistakeTimer > 0) {
        opponent.mistakeTimer -= dt;
        targetSpeed *= 0.55;
      } else if (opponent.mistakeCooldown <= 0) {
        if (Math.random() < 0.03 * (1.05 - opponent.skill)) {
          opponent.mistakeTimer = 0.6 + Math.random() * 0.7;
        }
        opponent.mistakeCooldown = 8 + Math.random() * 14;
      }

      planTargetSpeed[i] = targetSpeed;
      // Aim slightly ahead so we turn in toward the apex rather than chasing
      // the offset under our wheels.
      planTargetOffset[i] = racingLine.query(opponent.distance + 6).offset;
    }

    // Phase 2 — traffic & repulsion: fused O(n²) loop.
    for (let i = 0; i < opponents.length; i++) {
      const self = opponents[i]!;
      if (self.destroyed || !self.body) continue;

      let nearestAheadIdx = -1;
      let nearestAheadGap = Infinity;
      let push = 0;
      const longitRange = 14;
      const lateralBudget = 5.0;

      for (let j = 0; j < opponents.length; j++) {
        if (i === j) continue;
        const other = opponents[j]!;
        if (other.destroyed) continue;
        const gap = lapGap(self.distance, other.distance);

        if (gap > 0 && gap < nearestAheadGap) {
          nearestAheadGap = gap;
          nearestAheadIdx = j;
        }

        const longit = Math.abs(gap);
        if (longit < longitRange) {
          const lateral = self.laneOffset - other.laneOffset;
          const lateralAbs = Math.abs(lateral);
          if (lateralAbs < lateralBudget) {
            const longitFalloff = 1 - longit / longitRange;
            const sidewaysFalloff = 1 - lateralAbs / lateralBudget;
            const strength = longitFalloff * sidewaysFalloff;
            const pushSign = lateralAbs < 1e-3 ? (i < j ? 1 : -1) : Math.sign(lateral);
            push += pushSign * 4.5 * strength;
          }
        }
      }

      let desiredCommit = 0;
      let desiredOffsetShift = 0;
      let speedFollowWeight = 0;
      let speedFollowTarget = planTargetSpeed[i]!;
      if (nearestAheadIdx >= 0 && nearestAheadGap < FOLLOW_TRIGGER) {
        const other = opponents[nearestAheadIdx]!;
        const closingSpeed = self.speedMs - other.speedMs;
        const blockerOffset = other.laneOffset;
        const roomRight = OFFSET_LIMIT - blockerOffset;
        const roomLeft = OFFSET_LIMIT + blockerOffset;
        const passSign = roomRight >= roomLeft ? 1 : -1;
        const closeness = 1 - nearestAheadGap / FOLLOW_TRIGGER;
        const speedAdvantage = THREE.MathUtils.clamp(closingSpeed / 6, 0, 1);
        desiredCommit = closeness * (0.3 + 0.7 * speedAdvantage) * (0.4 + 0.6 * self.aggression);
        desiredOffsetShift = blockerOffset + passSign * 2.2;
        if (closingSpeed > 0) {
          speedFollowWeight = closeness * (1 - desiredCommit) *
            THREE.MathUtils.clamp((SAFE_GAP * 1.5 - nearestAheadGap) / SAFE_GAP, 0, 1);
          speedFollowTarget = other.speedMs + 0.4;
        }
      }

      self.overtakeCommit += (desiredCommit - self.overtakeCommit) * commitBlend;
      const baseLine = planTargetOffset[i]!;
      const overtakeLine = THREE.MathUtils.clamp(desiredOffsetShift, -OFFSET_LIMIT, OFFSET_LIMIT);
      planTargetOffset[i] = baseLine * (1 - self.overtakeCommit) + overtakeLine * self.overtakeCommit;
      planTargetSpeed[i] = planTargetSpeed[i]! * (1 - speedFollowWeight) +
        speedFollowTarget * speedFollowWeight;

      if (push !== 0) {
        planTargetOffset[i] = THREE.MathUtils.clamp(
          planTargetOffset[i]! + push,
          -OFFSET_LIMIT,
          OFFSET_LIMIT,
        );
      }
    }

    // Phase 3 — integrate and write to physics/mesh.
    for (let i = 0; i < opponents.length; i++) {
      const opponent = opponents[i]!;
      if (opponent.destroyed || !opponent.body) continue;

      const targetSpeed = planTargetSpeed[i]!;
      const dv = targetSpeed - opponent.speedMs;
      const rate = dv >= 0 ? ACCEL : DECEL;
      opponent.speedMs += THREE.MathUtils.clamp(dv, -rate * dt, rate * dt);
      if (opponent.speedMs < 0) opponent.speedMs = 0;
      opponent.distance += opponent.speedMs * dt;

      opponent.laneOffset += (planTargetOffset[i]! - opponent.laneOffset) * offsetBlend;

      const sample = racingLine.sampleAt(opponent.distance);
      opponent.tangent.copy(sample.tangent);
      const yaw = tangentToYaw(sample.tangent.x, sample.tangent.z);

      const offsetPos = sample.position.clone().addScaledVector(sample.right, opponent.laneOffset);
      opponent.mesh.position.set(offsetPos.x, 0.8, offsetPos.z);
      opponent.mesh.quaternion.setFromAxisAngle(up, yaw);
      opponent.body.setNextKinematicTranslation({
        x: offsetPos.x,
        y: 0.8,
        z: offsetPos.z,
      });
      opponent.body.setNextKinematicRotation({
        x: 0,
        y: Math.sin(yaw / 2),
        z: 0,
        w: Math.cos(yaw / 2),
      });
    }

    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i]!;
      d.life -= dt;
      d.velocity.y -= 14 * dt;
      d.velocity.multiplyScalar(0.992);
      d.mesh.position.addScaledVector(d.velocity, dt);
      d.mesh.rotation.x += d.angularVelocity.x * dt;
      d.mesh.rotation.y += d.angularVelocity.y * dt;
      d.mesh.rotation.z += d.angularVelocity.z * dt;
      if (d.mesh.position.y < 0.04) {
        d.mesh.position.y = 0.04;
        d.velocity.x *= 0.6;
        d.velocity.z *= 0.6;
        d.velocity.y *= -0.25;
      }
      if (d.life <= 0) {
        scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        if (d.mesh.material instanceof THREE.Material) d.mesh.material.dispose();
        debris.splice(i, 1);
      }
    }
  }

  function handlePlayerImpacts(playerBody: RAPIER.RigidBody): number {
    const playerPos = playerBody.translation();
    const playerVelRaw = playerBody.linvel();
    tmpPlayerVel.set(playerVelRaw.x, playerVelRaw.y, playerVelRaw.z);
    let destroyedCount = 0;

    const minDist = 2.9;
    for (const opponent of opponents) {
      if (opponent.destroyed || opponent.hitCooldown > 0) continue;
      tmpNormal.set(
        playerPos.x - opponent.mesh.position.x,
        0,
        playerPos.z - opponent.mesh.position.z,
      );
      const dist = tmpNormal.length();
      if (dist > minDist || dist < 1e-4) continue;
      tmpNormal.multiplyScalar(1 / dist);

      tmpOppVel.copy(opponent.tangent).multiplyScalar(opponent.speedMs);
      tmpRelVel.copy(tmpPlayerVel).sub(tmpOppVel);
      const approachSpeed = Math.max(0, -tmpRelVel.dot(tmpNormal));
      if (approachSpeed < IMPACT_DESTROY_SPEED) {
        opponent.hitCooldown = 0.18;
        continue;
      }

      const rebound = Math.min(9000, 2500 + approachSpeed * 210);
      playerBody.applyImpulse(
        { x: tmpNormal.x * rebound, y: 0, z: tmpNormal.z * rebound },
        true,
      );
      destroyOpponent(opponent, tmpNormal, approachSpeed);
      destroyedCount += 1;
    }

    return destroyedCount;
  }

  function getPlayerPosition(playerArcDistance: number): number {
    // Both sides are cumulative arc length along the centerline; we don't
    // need to derive laps separately. Whoever has the larger value is
    // physically further along the racing line.
    let ahead = 0;
    for (const opponent of opponents) {
      if (opponent.destroyed) continue;
      if (opponent.distance > playerArcDistance) ahead += 1;
    }
    return ahead + 1;
  }

  return {
    update,
    handlePlayerImpacts,
    getPlayerPosition,
    getTotalCars: () => 1 + opponents.filter((o) => !o.destroyed).length,
  };
}
