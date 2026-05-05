import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { getRAPIER } from '../physics';
import {
  CHECKPOINT_COUNT,
  KERB_WIDTH,
  TRACK_HALF_WIDTH,
  TRACK_SEGMENTS,
  createCenterline,
  createSilverstoneCircuit,
  createMonacoCircuit,
} from './circuit';

/** Per-sample frame along the centerline. */
interface TrackFrame {
  /** Centerline position at this sample. */
  position: THREE.Vector3;
  /** Tangent (forward direction along the centerline). */
  tangent: THREE.Vector3;
  /** Right-pointing perpendicular (in the X/Z plane). */
  right: THREE.Vector3;
  /** Cumulative arc length up to this sample (metres). */
  arcLength: number;
}

export interface TrackCheckpoint {
  /** Index in the ordered checkpoint ring; 0 is the start/finish line. */
  index: number;
  collider: RAPIER.Collider;
  position: THREE.Vector3;
  /** Forward direction at the checkpoint, useful for sanity checks. */
  forward: THREE.Vector3;
}

export interface LapInfo {
  /** Total length of the centerline in metres. */
  length: number;
  /** Number of checkpoints (including start/finish at index 0). */
  checkpointCount: number;
  /** Position (m) along the centerline of each checkpoint. */
  checkpointArcLengths: number[];
  /** Off-track grip multiplier (apply to traction when not on track). */
  offTrackGripMultiplier: number;
  /** Spawn pose for the car: position + forward direction. */
  spawn: { position: THREE.Vector3; forward: THREE.Vector3 };
}

export interface Track {
  mesh: THREE.Group;
  /** Trimesh collider for the asphalt + kerbs. */
  collider: RAPIER.Collider;
  checkpoints: TrackCheckpoint[];
  /** True if the world-space position projects within the asphalt strip. */
  isOnTrack: (pos: THREE.Vector3 | RAPIER.Vector) => boolean;
  /** Normalised progress along the centerline in [0, 1). */
  getProgress: (pos: THREE.Vector3 | RAPIER.Vector) => number;
  lapInfo: LapInfo;
  /** Clean up Rapier resources to prevent memory leaks. */
  dispose: () => void;
}

const SURFACE_Y = 0.02;
const BARRIER_SAMPLE_STEP = 3;
const BARRIER_OFFSET = 1.2;
const BARRIER_HEIGHT = 1.1;
const BARRIER_THICKNESS = 0.35;

/**
 * Build evenly-spaced sample frames along a closed Catmull-Rom curve.
 *
 * Uses simple parallel-transport: because the curve lies on Y=0 we lock the
 * "up" axis to +Y, which avoids the twist artefacts a generic Frenet frame
 * would produce on tight corners (where curvature flips sign).
 */
function buildFrames(
  curve: THREE.CatmullRomCurve3,
  segments: number,
): TrackFrame[] {
  const frames: TrackFrame[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  let cumulative = 0;
  let prevPos: THREE.Vector3 | null = null;

  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    const position = curve.getPointAt(t);
    // Force onto the Y=0 plane (Catmull-Rom may drift slightly numerically).
    position.y = 0;
    const tangent = curve.getTangentAt(t);
    tangent.y = 0;
    if (tangent.lengthSq() < 1e-8) {
      tangent.set(1, 0, 0);
    } else {
      tangent.normalize();
    }
    // Right-handed: right = tangent x up (in our coords this points to the
    // driver's right when travelling along +tangent).
    const right = new THREE.Vector3().crossVectors(tangent, up).normalize();

    if (prevPos !== null) {
      cumulative += position.distanceTo(prevPos);
    }
    frames.push({ position, tangent, right, arcLength: cumulative });
    prevPos = position;
  }
  return frames;
}

/**
 * Build the ribbon geometry. Across the width we have 5 longitudinal strips:
 *   col 0: outer edge of left kerb
 *   col 1: inner edge of left kerb (== left edge of asphalt)
 *   col 2: centerline
 *   col 3: right edge of asphalt (== inner edge of right kerb)
 *   col 4: outer edge of right kerb
 *
 * We emit positions, indices, vertex colours (so the kerbs render
 * red/white-striped without needing a texture), and UVs.
 */
function buildRibbon(frames: TrackFrame[]): {
  asphaltGeo: THREE.BufferGeometry;
  kerbLeftGeo: THREE.BufferGeometry;
  kerbRightGeo: THREE.BufferGeometry;
  /** Combined vertex/index buffer for the Rapier trimesh collider. */
  collider: { vertices: Float32Array; indices: Uint32Array };
} {
  const segCount = frames.length; // closed loop, so we wrap segCount -> 0
  const halfW = TRACK_HALF_WIDTH;
  const kerbW = KERB_WIDTH;

  // Asphalt: 2 vertices per segment, segCount segments, closed loop.
  const asphaltPos = new Float32Array(segCount * 2 * 3);
  const asphaltUv = new Float32Array(segCount * 2 * 2);
  const asphaltIdx: number[] = [];

  // Kerbs: 2 vertices per segment per side, with vertex colours alternating.
  const kerbLeftPos = new Float32Array(segCount * 2 * 3);
  const kerbLeftCol = new Float32Array(segCount * 2 * 3);
  const kerbLeftIdx: number[] = [];
  const kerbRightPos = new Float32Array(segCount * 2 * 3);
  const kerbRightCol = new Float32Array(segCount * 2 * 3);
  const kerbRightIdx: number[] = [];

  // For the physics trimesh we want a single buffer covering the full kerb-to-
  // kerb width (so cars resting on the kerb don't fall through). 4 verts per
  // segment, columns 0..3 covering [outer-left .. outer-right].
  const colliderVerts = new Float32Array(segCount * 4 * 3);
  const colliderIdx: number[] = [];

  // Slight Y offset so the asphalt sits visibly above the surrounding ground
  // and so the trimesh isn't perfectly co-planar with anything else.
  const surfaceY = SURFACE_Y;
  const kerbY = 0.06; // kerbs slightly proud of the asphalt

  for (let i = 0; i < segCount; i++) {
    const f = frames[i]!;
    const cx = f.position.x;
    const cz = f.position.z;
    const rx = f.right.x;
    const rz = f.right.z;

    // Asphalt edges
    const lx = cx - rx * halfW;
    const lz = cz - rz * halfW;
    const ax = cx + rx * halfW;
    const az = cz + rz * halfW;
    // Kerb outer edges
    const olx = cx - rx * (halfW + kerbW);
    const olz = cz - rz * (halfW + kerbW);
    const orx = cx + rx * (halfW + kerbW);
    const orz = cz + rz * (halfW + kerbW);

    // Asphalt verts: 0 = left edge, 1 = right edge.
    asphaltPos[i * 6 + 0] = lx;
    asphaltPos[i * 6 + 1] = surfaceY;
    asphaltPos[i * 6 + 2] = lz;
    asphaltPos[i * 6 + 3] = ax;
    asphaltPos[i * 6 + 4] = surfaceY;
    asphaltPos[i * 6 + 5] = az;

    // UVs: U across the track (0..1), V along arc length tiled every 4 m.
    const v = f.arcLength / 4.0;
    asphaltUv[i * 4 + 0] = 0;
    asphaltUv[i * 4 + 1] = v;
    asphaltUv[i * 4 + 2] = 1;
    asphaltUv[i * 4 + 3] = v;

    // Kerb verts: outer + inner. Alternate red/white every ~2 segments for a
    // classic F1 kerb stripe. For the closed loop we want CHECKPOINT_COUNT-
    // independent stripes, so mod 2 over a chosen stripe length.
    const stripeLen = 2;
    const stripe = Math.floor(i / stripeLen) % 2;
    const cR = stripe === 0 ? 0.85 : 0.05;
    const cG = stripe === 0 ? 0.85 : 0.05;
    const cB = stripe === 0 ? 0.85 : 0.05;
    const rR = stripe === 0 ? 0.85 : 0.05;
    const rG = stripe === 0 ? 0.05 : 0.05;
    const rB = stripe === 0 ? 0.05 : 0.05;
    // Left kerb: outer (col 0), inner (col 1)
    kerbLeftPos[i * 6 + 0] = olx;
    kerbLeftPos[i * 6 + 1] = kerbY;
    kerbLeftPos[i * 6 + 2] = olz;
    kerbLeftPos[i * 6 + 3] = lx;
    kerbLeftPos[i * 6 + 4] = kerbY;
    kerbLeftPos[i * 6 + 5] = lz;
    kerbLeftCol[i * 6 + 0] = cR;
    kerbLeftCol[i * 6 + 1] = cG;
    kerbLeftCol[i * 6 + 2] = cB;
    kerbLeftCol[i * 6 + 3] = cR;
    kerbLeftCol[i * 6 + 4] = cG;
    kerbLeftCol[i * 6 + 5] = cB;
    // Right kerb
    kerbRightPos[i * 6 + 0] = ax;
    kerbRightPos[i * 6 + 1] = kerbY;
    kerbRightPos[i * 6 + 2] = az;
    kerbRightPos[i * 6 + 3] = orx;
    kerbRightPos[i * 6 + 4] = kerbY;
    kerbRightPos[i * 6 + 5] = orz;
    kerbRightCol[i * 6 + 0] = rR;
    kerbRightCol[i * 6 + 1] = rG;
    kerbRightCol[i * 6 + 2] = rB;
    kerbRightCol[i * 6 + 3] = rR;
    kerbRightCol[i * 6 + 4] = rG;
    kerbRightCol[i * 6 + 5] = rB;
    // Suppress unused-stripe-colour warnings: we want red stripes only when
    // stripe===1; pack that here.
    if (stripe === 1) {
      // outer-left stripe red
      kerbLeftCol[i * 6 + 0] = 0.78;
      kerbLeftCol[i * 6 + 1] = 0.05;
      kerbLeftCol[i * 6 + 2] = 0.06;
      kerbLeftCol[i * 6 + 3] = 0.78;
      kerbLeftCol[i * 6 + 4] = 0.05;
      kerbLeftCol[i * 6 + 5] = 0.06;
      kerbRightCol[i * 6 + 0] = 0.78;
      kerbRightCol[i * 6 + 1] = 0.05;
      kerbRightCol[i * 6 + 2] = 0.06;
      kerbRightCol[i * 6 + 3] = 0.78;
      kerbRightCol[i * 6 + 4] = 0.05;
      kerbRightCol[i * 6 + 5] = 0.06;
    }

    // Collider strip: 4 columns per segment.
    colliderVerts[i * 12 + 0] = olx;
    colliderVerts[i * 12 + 1] = surfaceY;
    colliderVerts[i * 12 + 2] = olz;
    colliderVerts[i * 12 + 3] = lx;
    colliderVerts[i * 12 + 4] = surfaceY;
    colliderVerts[i * 12 + 5] = lz;
    colliderVerts[i * 12 + 6] = ax;
    colliderVerts[i * 12 + 7] = surfaceY;
    colliderVerts[i * 12 + 8] = az;
    colliderVerts[i * 12 + 9] = orx;
    colliderVerts[i * 12 + 10] = surfaceY;
    colliderVerts[i * 12 + 11] = orz;
  }

  // Indices for ribbons (closed loop wraps).
  for (let i = 0; i < segCount; i++) {
    const i0 = i;
    const i1 = (i + 1) % segCount;
    const a0 = i0 * 2 + 0;
    const a1 = i0 * 2 + 1;
    const b0 = i1 * 2 + 0;
    const b1 = i1 * 2 + 1;
    asphaltIdx.push(a0, b0, a1, a1, b0, b1);
    kerbLeftIdx.push(a0, b0, a1, a1, b0, b1);
    kerbRightIdx.push(a0, b0, a1, a1, b0, b1);
  }
  // Indices for the 4-column collider strip.
  for (let i = 0; i < segCount; i++) {
    const i0 = i;
    const i1 = (i + 1) % segCount;
    for (let c = 0; c < 3; c++) {
      const a0 = i0 * 4 + c;
      const a1 = i0 * 4 + c + 1;
      const b0 = i1 * 4 + c;
      const b1 = i1 * 4 + c + 1;
      colliderIdx.push(a0, b0, a1, a1, b0, b1);
    }
  }

  const asphaltGeo = new THREE.BufferGeometry();
  asphaltGeo.setAttribute('position', new THREE.BufferAttribute(asphaltPos, 3));
  asphaltGeo.setAttribute('uv', new THREE.BufferAttribute(asphaltUv, 2));
  asphaltGeo.setIndex(asphaltIdx);
  asphaltGeo.computeVertexNormals();

  const kerbLeftGeo = new THREE.BufferGeometry();
  kerbLeftGeo.setAttribute(
    'position',
    new THREE.BufferAttribute(kerbLeftPos, 3),
  );
  kerbLeftGeo.setAttribute('color', new THREE.BufferAttribute(kerbLeftCol, 3));
  kerbLeftGeo.setIndex(kerbLeftIdx);
  kerbLeftGeo.computeVertexNormals();

  const kerbRightGeo = new THREE.BufferGeometry();
  kerbRightGeo.setAttribute(
    'position',
    new THREE.BufferAttribute(kerbRightPos, 3),
  );
  kerbRightGeo.setAttribute(
    'color',
    new THREE.BufferAttribute(kerbRightCol, 3),
  );
  kerbRightGeo.setIndex(kerbRightIdx);
  kerbRightGeo.computeVertexNormals();

  return {
    asphaltGeo,
    kerbLeftGeo,
    kerbRightGeo,
    collider: {
      vertices: colliderVerts,
      indices: new Uint32Array(colliderIdx),
    },
  };
}

function buildBarriers(
  world: RAPIER.World,
  frames: TrackFrame[],
): { group: THREE.Group; colliders: RAPIER.Collider[] } {
  const RAPIER_NS = getRAPIER();
  const group = new THREE.Group();
  group.name = 'TrackBarriers';
  const colliders: RAPIER.Collider[] = [];

  const material = new THREE.MeshStandardMaterial({
    color: 0xf4f4f4,
    roughness: 0.5,
    metalness: 0.2,
  });

  const halfHeight = BARRIER_HEIGHT * 0.5;
  const lateral = TRACK_HALF_WIDTH + KERB_WIDTH + BARRIER_OFFSET;

  // Pre-count how many barrier segments we'll generate so we can allocate the
  // InstancedMesh with the right capacity. Each iteration produces 2 segments
  // (left + right), and we step through frames with BARRIER_SAMPLE_STEP.
  const segmentsPerSide = Math.ceil(frames.length / BARRIER_SAMPLE_STEP);
  const totalInstances = segmentsPerSide * 2;

  // Single InstancedMesh for ALL ~170 barriers instead of one Mesh per segment.
  // Was: 170 individual draw calls every frame (one per Mesh).
  // Now: 1 draw call total. Three.js doesn't auto-batch; instancing is the
  // only way to collapse identical-material meshes into a single GPU submission.
  //
  // Each instance shares the same unit-cube geometry (1×1×1 box). We use the
  // per-instance Matrix4 to translate, rotate, and scale (length × height ×
  // thickness) it into the right segment. This is mathematically identical to
  // what the old code did with a fresh BoxGeometry per segment, but cheaper.
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const instancedMesh = new THREE.InstancedMesh(unitBox, material, totalInstances);
  instancedMesh.castShadow = false;
  instancedMesh.receiveShadow = true;
  // We never animate the matrices after init, so disable per-frame matrix
  // upload to the GPU.
  instancedMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

  const tmpMatrix = new THREE.Matrix4();
  const tmpPos = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  let instanceIndex = 0;

  for (let i = 0; i < frames.length; i += BARRIER_SAMPLE_STEP) {
    const next = (i + BARRIER_SAMPLE_STEP) % frames.length;
    const a = frames[i]!;
    const b = frames[next]!;
    const dx = b.position.x - a.position.x;
    const dz = b.position.z - a.position.z;
    // Barrier box length is along local +X, so convert segment direction to
    // the Y-rotation that aligns local X with world (dx, dz).
    const yaw = Math.atan2(-dz, dx);

    const leftA = a.position.clone().addScaledVector(a.right, -lateral);
    const leftB = b.position.clone().addScaledVector(b.right, -lateral);
    const rightA = a.position.clone().addScaledVector(a.right, lateral);
    const rightB = b.position.clone().addScaledVector(b.right, lateral);

    const createBarrierSegment = (p0: THREE.Vector3, p1: THREE.Vector3) => {
      const center = p0.clone().add(p1).multiplyScalar(0.5);
      const length = Math.max(0.75, p0.distanceTo(p1));
      const halfLength = length * 0.5;
      const halfThickness = BARRIER_THICKNESS * 0.5;

      // Set instance transform: position at segment center, yaw rotation, and
      // scale the unit cube to (length, height, thickness).
      tmpPos.set(center.x, SURFACE_Y + halfHeight, center.z);
      tmpQuat.setFromAxisAngle(yAxis, yaw);
      tmpScale.set(length, BARRIER_HEIGHT, BARRIER_THICKNESS);
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
      instancedMesh.setMatrixAt(instanceIndex++, tmpMatrix);

      const sinHalf = Math.sin(yaw / 2);
      const cosHalf = Math.cos(yaw / 2);
      const colliderDesc = RAPIER_NS.ColliderDesc.cuboid(
        halfLength,
        halfHeight,
        halfThickness,
      )
        .setTranslation(center.x, SURFACE_Y + halfHeight, center.z)
        .setRotation({ x: 0, y: sinHalf, z: 0, w: cosHalf })
        .setFriction(0.7)
        .setRestitution(0.08);
      const collider = world.createCollider(colliderDesc);
      colliders.push(collider);
    };

    createBarrierSegment(leftA, leftB);
    createBarrierSegment(rightA, rightB);
  }

  // If we allocated more instances than we used (because totalInstances was
  // a ceiling estimate), set the unused matrices to zero scale so they don't
  // render as a stray box at the origin.
  if (instanceIndex < totalInstances) {
    tmpMatrix.makeScale(0, 0, 0);
    for (let k = instanceIndex; k < totalInstances; k++) {
      instancedMesh.setMatrixAt(k, tmpMatrix);
    }
  }
  instancedMesh.instanceMatrix.needsUpdate = true;
  instancedMesh.count = instanceIndex;
  group.add(instancedMesh);

  return { group, colliders };
}

/**
 * Build the checkered start/finish line plane. It sits on top of the asphalt
 * at the very first frame, perpendicular to the racing direction.
 */
function buildStartFinish(frames: TrackFrame[]): THREE.Mesh {
  const f = frames[0]!;
  const stripeCount = 12;
  const cells = stripeCount * 2; // along-track resolution
  const w = TRACK_HALF_WIDTH * 2;
  const h = 2.0; // metres along the racing direction
  const geo = new THREE.PlaneGeometry(w, h, cells, 2);

  // Build a checker-pattern colour attribute.
  const colors = new Float32Array(geo.attributes['position']!.count * 3);
  const positions = geo.attributes['position']!.array as Float32Array;
  for (let i = 0; i < geo.attributes['position']!.count; i++) {
    const x = positions[i * 3 + 0]!; // along width before rotation
    const y = positions[i * 3 + 1]!; // along length before rotation
    const cellX = Math.floor((x / w + 0.5) * stripeCount);
    const cellY = Math.floor((y / h + 0.5) * 2);
    const isWhite = (cellX + cellY) % 2 === 0;
    const c = isWhite ? 0.95 : 0.02;
    colors[i * 3 + 0] = c;
    colors[i * 3 + 1] = c;
    colors[i * 3 + 2] = c;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // Lay flat (PlaneGeometry is in XY, we need XZ).
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.7,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  // Orient: align local +Z (after rotateX) with the tangent direction.
  // Default forward after rotateX(-PI/2) is +Z (was +Y in plane-local).
  const yaw = Math.atan2(f.tangent.x, f.tangent.z);
  mesh.rotation.y = yaw;
  mesh.position.set(f.position.x, 0.04, f.position.z);
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Place CHECKPOINT_COUNT sensor colliders evenly along the centerline, with
 * checkpoint 0 sitting on the start/finish line.
 */
function buildCheckpoints(
  world: RAPIER.World,
  frames: TrackFrame[],
  totalLength: number,
): TrackCheckpoint[] {
  const RAPIER_NS = getRAPIER();
  const checkpoints: TrackCheckpoint[] = [];
  const spacing = totalLength / CHECKPOINT_COUNT;
  // Map each desired arc length to its nearest sample frame index.
  for (let i = 0; i < CHECKPOINT_COUNT; i++) {
    const targetArc = i * spacing;
    let bestIdx = 0;
    let bestDelta = Infinity;
    for (let j = 0; j < frames.length; j++) {
      const d = Math.abs(frames[j]!.arcLength - targetArc);
      if (d < bestDelta) {
        bestDelta = d;
        bestIdx = j;
      }
    }
    const f = frames[bestIdx]!;

    // A box sensor spanning the full track width, ~1 m thick along the
    // racing direction, ~3 m tall. We use cuboid + rotation.
    const halfW = TRACK_HALF_WIDTH + 0.5;
    const halfThickness = 0.5;
    const halfHeight = 1.5;
    const yaw = Math.atan2(f.tangent.x, f.tangent.z);
    // Rapier rotation as quaternion around Y axis.
    const sinHalf = Math.sin(yaw / 2);
    const cosHalf = Math.cos(yaw / 2);
    const desc = RAPIER_NS.ColliderDesc.cuboid(halfW, halfHeight, halfThickness)
      .setSensor(true)
      .setTranslation(f.position.x, halfHeight, f.position.z)
      .setRotation({ x: 0, y: sinHalf, z: 0, w: cosHalf });
    const collider = world.createCollider(desc);
    checkpoints.push({
      index: i,
      collider,
      position: f.position.clone(),
      forward: f.tangent.clone(),
    });
  }
  return checkpoints;
}

export type TrackType = 'default' | 'silverstone' | 'monaco';

export function createTrack(
  world: RAPIER.World,
  scene: THREE.Scene,
  trackType: TrackType = 'default',
): Track {
  const RAPIER_NS = getRAPIER();
  const curve = trackType === 'silverstone'
    ? createSilverstoneCircuit()
    : trackType === 'monaco'
    ? createMonacoCircuit()
    : createCenterline();
  const frames = buildFrames(curve, TRACK_SEGMENTS);
  // Total arc length: distance from last sample back to first.
  const last = frames[frames.length - 1]!;
  const first = frames[0]!;
  const totalLength = last.arcLength + last.position.distanceTo(first.position);

  const ribbon = buildRibbon(frames);

  const asphaltMat = new THREE.MeshStandardMaterial({
    color: 0x1c1c1f,
    roughness: 0.85,
    metalness: 0.0,
  });
  const asphaltMesh = new THREE.Mesh(ribbon.asphaltGeo, asphaltMat);
  asphaltMesh.receiveShadow = true;

  const kerbMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.5,
    metalness: 0.0,
  });
  const kerbLeft = new THREE.Mesh(ribbon.kerbLeftGeo, kerbMat);
  kerbLeft.receiveShadow = true;
  const kerbRight = new THREE.Mesh(ribbon.kerbRightGeo, kerbMat);
  kerbRight.receiveShadow = true;

  const startFinish = buildStartFinish(frames);
  const barriers = buildBarriers(world, frames);

  const group = new THREE.Group();
  group.name = 'Track';
  group.add(asphaltMesh);
  group.add(kerbLeft);
  group.add(kerbRight);
  group.add(startFinish);
  group.add(barriers.group);
  scene.add(group);

  // Trimesh collider for the full kerb-to-kerb strip.
  const colliderDesc = RAPIER_NS.ColliderDesc.trimesh(
    ribbon.collider.vertices,
    ribbon.collider.indices,
  )
    .setFriction(1.1)
    .setRestitution(0.0);
  const collider = world.createCollider(colliderDesc);

  const checkpoints = buildCheckpoints(world, frames, totalLength);

  // Spawn pose: a few metres BEFORE the start/finish line, on the centerline,
  // facing along the tangent. We back up along -tangent by half the start/
  // finish strip plus a margin.
  const spawnPos = first.position
    .clone()
    .addScaledVector(first.tangent, -6.0);
  spawnPos.y = 1.2;

  // Build a flat array of frame data for the lookup helpers.
  const frameXZ = new Float32Array(frames.length * 4);
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!;
    frameXZ[i * 4 + 0] = f.position.x;
    frameXZ[i * 4 + 1] = f.position.z;
    frameXZ[i * 4 + 2] = f.tangent.x;
    frameXZ[i * 4 + 3] = f.tangent.z;
  }

  // Local search anchor: a single car (the player) calls findNearest twice
  // per frame, so caching the previous nearest index lets us limit the scan
  // to its neighbourhood. ±16 of 256 frames is ~1/8 of the loop — many
  // multiples of one frame's travel even at 85 m/s — and is robust to
  // skipping a sample on uneven sampling. If the local search saturates at
  // the window edge (e.g. respawn / teleport) we fall back to a full scan.
  let lastIdx = 0;
  const SEARCH_RADIUS = 16;

  const findNearest = (
    pos: THREE.Vector3 | RAPIER.Vector,
  ): { index: number; lateral: number; along: number } => {
    const px = (pos as { x: number }).x;
    const pz = (pos as { z: number }).z;
    let bestIdx = lastIdx;
    let bestDistSq = Infinity;
    let bestK = 0;
    for (let k = -SEARCH_RADIUS; k <= SEARCH_RADIUS; k++) {
      const i = (lastIdx + k + frames.length) % frames.length;
      const fx = frameXZ[i * 4 + 0]!;
      const fz = frameXZ[i * 4 + 1]!;
      const dx = px - fx;
      const dz = pz - fz;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        bestIdx = i;
        bestK = k;
      }
    }
    if (bestK === -SEARCH_RADIUS || bestK === SEARCH_RADIUS) {
      bestDistSq = Infinity;
      for (let i = 0; i < frames.length; i++) {
        const fx = frameXZ[i * 4 + 0]!;
        const fz = frameXZ[i * 4 + 1]!;
        const dx = px - fx;
        const dz = pz - fz;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestIdx = i;
        }
      }
    }
    lastIdx = bestIdx;
    // Refine: project onto the segment between bestIdx and its neighbour with
    // the smaller distance.
    const prev = (bestIdx - 1 + frames.length) % frames.length;
    const next = (bestIdx + 1) % frames.length;
    const candidates = [prev, next];
    let refinedAlong = 0;
    let refinedLateral = 0;
    let refinedIdx = bestIdx;
    let refinedScore = Infinity;
    for (const j of candidates) {
      const a = bestIdx;
      const b = j;
      const ax = frameXZ[a * 4 + 0]!;
      const az = frameXZ[a * 4 + 1]!;
      const bx = frameXZ[b * 4 + 0]!;
      const bz = frameXZ[b * 4 + 1]!;
      const segDx = bx - ax;
      const segDz = bz - az;
      const segLen2 = segDx * segDx + segDz * segDz;
      if (segLen2 < 1e-6) continue;
      const t = Math.max(
        0,
        Math.min(1, ((px - ax) * segDx + (pz - az) * segDz) / segLen2),
      );
      const projX = ax + segDx * t;
      const projZ = az + segDz * t;
      const dx = px - projX;
      const dz = pz - projZ;
      const lateral = Math.sqrt(dx * dx + dz * dz);
      // Along direction: signed length from sample a's arc length plus t * seg.
      const segLen = Math.sqrt(segLen2);
      const along = frames[a]!.arcLength + t * segLen * (j === next ? 1 : -1);
      if (lateral < refinedScore) {
        refinedScore = lateral;
        refinedLateral = lateral;
        refinedAlong = along;
        refinedIdx = a;
      }
    }
    if (!Number.isFinite(refinedScore)) {
      refinedLateral = Math.sqrt(bestDistSq);
      refinedAlong = frames[bestIdx]!.arcLength;
    }
    return { index: refinedIdx, lateral: refinedLateral, along: refinedAlong };
  };

  const isOnTrack = (pos: THREE.Vector3 | RAPIER.Vector): boolean => {
    const r = findNearest(pos);
    return r.lateral <= TRACK_HALF_WIDTH;
  };

  const getProgress = (pos: THREE.Vector3 | RAPIER.Vector): number => {
    const r = findNearest(pos);
    let along = r.along;
    while (along < 0) along += totalLength;
    while (along >= totalLength) along -= totalLength;
    return along / totalLength;
  };

  const lapInfo: LapInfo = {
    length: totalLength,
    checkpointCount: checkpoints.length,
    checkpointArcLengths: checkpoints.map(
      (_, i) => (i / checkpoints.length) * totalLength,
    ),
    offTrackGripMultiplier: 0.45,
    spawn: { position: spawnPos, forward: first.tangent.clone() },
  };

  const dispose = (): void => {
    // Note: Rapier's high-level API does not expose .free() on individual
    // Colliders. Memory is managed by the World and released when
    // world.removeCollider() is called, or when world.free() is called.
    // We remove colliders from the world here to ensure proper cleanup.
    world.removeCollider(collider, false);

    checkpoints.forEach((cp) => {
      world.removeCollider(cp.collider, false);
    });

    barriers.colliders.forEach((barrierCollider) => {
      world.removeCollider(barrierCollider, false);
    });
  };

  return {
    mesh: group,
    collider,
    checkpoints,
    isOnTrack,
    getProgress,
    lapInfo,
    dispose,
  };
}
