import * as THREE from 'three';
import { TRACK_HALF_WIDTH, createCenterline } from '../track/circuit';
import { wrapDistance } from '../utils/math';

export interface RacingLineSample {
  /** Cumulative arc length along the centerline at this sample (m). */
  arcLength: number;
  /** Centerline position. */
  position: THREE.Vector3;
  /** Forward tangent (XZ plane, normalised). */
  tangent: THREE.Vector3;
  /** Right perpendicular (tangent × up). */
  right: THREE.Vector3;
  /** Signed curvature, positive = right turn (1/m). */
  curvature: number;
  /** Lateral offset of the ideal racing line from the centerline, in metres
   *  (positive = right of centerline). Designed so apex is on the inside. */
  racingOffset: number;
  /** Maximum safe speed at this sample after look-ahead braking sweep (m/s). */
  speedLimit: number;
}

export interface RacingLine {
  samples: RacingLineSample[];
  /** Total length of the centerline (m). */
  length: number;
  /** Look up sample by arc length (with wrap-around). */
  sampleAt: (arcLength: number) => RacingLineSample;
  /** Linearly interpolated speed limit & offset at arbitrary arc length. */
  query: (arcLength: number) => { offset: number; speed: number };
}

const SAMPLE_COUNT = 512;
// "Friction × g" — effective lateral acceleration the AI plans for. The
// player's tyres can do more, but planning conservatively keeps the AI on
// the track and gives a believable cornering rhythm.
const LATERAL_GRIP = 16.0; // m/s² (~μ=1.6, g=9.81)
// Comfortable braking deceleration for the look-ahead sweep.
const BRAKE_DECEL = 22.0; // m/s²
const TOP_SPEED = 80; // m/s — matches car top speed
// How aggressively to bias the racing line toward the inside of corners.
// Tuned so a tight corner reaches roughly the asphalt edge.
const APEX_BIAS = 220.0;
// Keep clear of the kerb edge by ~1 m so AI cars don't drop two wheels off.
const MAX_OFFSET = TRACK_HALF_WIDTH - 1.5;
// Width of the rolling window (in samples) for smoothing curvature into the
// offset profile. Wider = earlier turn-in, narrower = later, sharper apex.
const SMOOTH_WINDOW = 12;

export function buildRacingLine(): RacingLine {
  const curve = createCenterline();
  const samples: RacingLineSample[] = new Array(SAMPLE_COUNT);
  const up = new THREE.Vector3(0, 1, 0);

  // Pass 1: positions, tangents, arc length.
  let cumulative = 0;
  let prev: THREE.Vector3 | null = null;
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const t = i / SAMPLE_COUNT;
    const position = curve.getPointAt(t);
    position.y = 0;
    const tangent = curve.getTangentAt(t);
    tangent.y = 0;
    if (tangent.lengthSq() < 1e-8) tangent.set(1, 0, 0);
    else tangent.normalize();
    const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
    if (prev) cumulative += position.distanceTo(prev);
    prev = position;
    samples[i] = {
      arcLength: cumulative,
      position,
      tangent,
      right,
      curvature: 0,
      racingOffset: 0,
      speedLimit: TOP_SPEED,
    };
  }
  // Close the loop: arc length from last to first.
  const length = cumulative + samples[SAMPLE_COUNT - 1]!.position.distanceTo(samples[0]!.position);

  // Pass 2: signed curvature from tangent rotation between neighbours.
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const a = samples[(i - 1 + SAMPLE_COUNT) % SAMPLE_COUNT]!;
    const b = samples[(i + 1) % SAMPLE_COUNT]!;
    const ds = (b.arcLength - a.arcLength + length) % length || 1e-3;
    // Sign: y-component of tangent_a × tangent_b. In right-handed coords with
    // up=+Y, a positive y means counter-clockwise rotation viewed from above
    // — which in this game's coord system means a left turn. We flip the
    // sign so positive = right turn (matches `right` vector convention).
    const crossY = a.tangent.x * b.tangent.z - a.tangent.z * b.tangent.x;
    const dot = THREE.MathUtils.clamp(a.tangent.dot(b.tangent), -1, 1);
    const angle = Math.acos(dot);
    samples[i]!.curvature = (crossY >= 0 ? 1 : -1) * (angle / ds);
  }

  // Pass 3: smooth curvature into a lateral offset (apex inside the corner).
  // We use a centred rolling average over SMOOTH_WINDOW samples and clamp.
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    let acc = 0;
    for (let k = -SMOOTH_WINDOW; k <= SMOOTH_WINDOW; k++) {
      acc += samples[(i + k + SAMPLE_COUNT) % SAMPLE_COUNT]!.curvature;
    }
    const smooth = acc / (SMOOTH_WINDOW * 2 + 1);
    // Inside of a right turn (curvature > 0) is to the right, which means we
    // want offset > 0 (along +right). So sign matches.
    const raw = smooth * APEX_BIAS;
    samples[i]!.racingOffset = THREE.MathUtils.clamp(raw, -MAX_OFFSET, MAX_OFFSET);
  }

  // Pass 4: speed limit from instantaneous curvature, then backward sweep.
  for (const s of samples) {
    const k = Math.max(Math.abs(s.curvature), 1e-4);
    s.speedLimit = Math.min(TOP_SPEED, Math.sqrt(LATERAL_GRIP / k));
  }
  // Backward look-ahead: at sample i, we must already be braked enough to
  // reach the upcoming sample's limit. Iterate twice to converge around the loop.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = SAMPLE_COUNT - 1; i >= 0; i--) {
      const next = samples[(i + 1) % SAMPLE_COUNT]!;
      const cur = samples[i]!;
      const ds = (next.arcLength - cur.arcLength + length) % length || 1e-3;
      const reachable = Math.sqrt(next.speedLimit * next.speedLimit + 2 * BRAKE_DECEL * ds);
      if (reachable < cur.speedLimit) cur.speedLimit = reachable;
    }
  }

  let lastIndex = 0;

  function indexFor(arcLength: number): number {
    const wrapped = wrapDistance(arcLength, length);
    // Start search from last successful index (spatial coherence optimization).
    let i = lastIndex;
    for (let n = 0; n < SAMPLE_COUNT; n++) {
      const a = samples[i]!.arcLength;
      const b = samples[(i + 1) % SAMPLE_COUNT]!.arcLength;
      const bAdj = b < a ? b + length : b;
      if (wrapped >= a && wrapped <= bAdj) {
        lastIndex = i;
        return i;
      }
      i = (i + 1) % SAMPLE_COUNT;
    }
    return lastIndex;
  }

  function sampleAt(arcLength: number): RacingLineSample {
    return samples[indexFor(arcLength)]!;
  }

  function query(arcLength: number): { offset: number; speed: number } {
    const i = indexFor(arcLength);
    const a = samples[i]!;
    const b = samples[(i + 1) % SAMPLE_COUNT]!;
    const wrapped = wrapDistance(arcLength, length);
    const aArc = a.arcLength;
    const bArc = b.arcLength < aArc ? b.arcLength + length : b.arcLength;
    const span = bArc - aArc || 1e-3;
    const u = THREE.MathUtils.clamp((wrapped - aArc) / span, 0, 1);
    return {
      offset: a.racingOffset + (b.racingOffset - a.racingOffset) * u,
      speed: a.speedLimit + (b.speedLimit - a.speedLimit) * u,
    };
  }

  return { samples, length, sampleAt, query };
}
