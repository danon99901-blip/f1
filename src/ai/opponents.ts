import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { RAPIER as RAPIER_NS } from '../physics';
import { createCarModel } from '../car/vehicle';
import { createCenterline } from '../track/circuit';

interface Opponent {
  mesh: THREE.Group;
  body: RAPIER.RigidBody | null;
  collider: RAPIER.Collider | null;
  distance: number;
  baseSpeed: number;
  pacePhase: number;
  laneOffset: number;
  speedMs: number;
  tangent: THREE.Vector3;
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
  getPlayerPosition: (playerLap: number, playerProgress: number) => number;
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
  const centerline = createCenterline();
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
    opponents.push({
      mesh,
      body,
      collider,
      distance,
      baseSpeed: 32 + i * 1.2,
      pacePhase: i * 0.8,
      laneOffset: side * 1.8,
      speedMs: 0,
      tangent: new THREE.Vector3(0, 0, -1),
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

  function update(dt: number, elapsedTime: number, playerSpeedKmh: number): void {
    const playerSpeedMs = Math.max(0, playerSpeedKmh / 3.6);
    const adaptiveCap = Math.max(20, playerSpeedMs * 0.9);
    for (const opponent of opponents) {
      opponent.hitCooldown = Math.max(0, opponent.hitCooldown - dt);
      if (opponent.destroyed || !opponent.body) continue;

      const paceWave = Math.sin(elapsedTime * 0.5 + opponent.pacePhase) * 0.08;
      const targetSpeed = opponent.baseSpeed * (1 + paceWave);
      const speed = Math.min(targetSpeed, adaptiveCap);
      opponent.speedMs = speed;
      opponent.distance += speed * dt;

      const wrapped = ((opponent.distance % trackLength) + trackLength) % trackLength;
      const t = wrapped / trackLength;

      const pos = centerline.getPointAt(t);
      const tangent = centerline.getTangentAt(t).normalize();
      opponent.tangent.copy(tangent);
      const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
      const yaw = Math.atan2(-tangent.x, -tangent.z);

      const offsetPos = pos.addScaledVector(right, opponent.laneOffset);
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

  function getPlayerPosition(playerLap: number, playerProgress: number): number {
    const playerDistance = (Math.max(0, playerLap - 1) + playerProgress) * trackLength;
    let ahead = 0;

    for (const opponent of opponents) {
      if (opponent.destroyed) continue;
      const opponentLap = Math.floor(opponent.distance / trackLength) + 1;
      const wrapped = ((opponent.distance % trackLength) + trackLength) % trackLength;
      const opponentProgress = wrapped / trackLength;
      const opponentDistance = (Math.max(0, opponentLap - 1) + opponentProgress) * trackLength;
      if (opponentDistance > playerDistance) ahead += 1;
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
