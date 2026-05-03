import * as THREE from 'three';

/**
 * Control points for a closed-loop F1-ish circuit on the Y=0 plane.
 *
 * Layout (16 control points, walking the loop clockwise when looking down +Y):
 *
 *   0  Start/finish — pit straight, heading east
 *   1  End of pit straight, light braking
 *   2  Turn 1 — tight right-hander
 *   3  Turn 2 — short chute
 *   4  Turn 3 — medium left
 *   5  Esses A — right
 *   6  Esses B — left
 *   7  Esses C — right (fast flick sequence ends here)
 *   8  Turn 7 — looping right onto back straight
 *   9  Back-straight braking zone
 *  10  Turn 8 — heavy braking into hairpin entry
 *  11  Turn 9 — HAIRPIN apex
 *  12  Turn 9 — hairpin exit
 *  13  Turn 10 — medium left
 *  14  Turn 11 — fast right kink
 *  15  Final corner — long left onto pit straight
 *
 * That's 11 named corners plus a hairpin and an esses sequence, with two long
 * straights (pit straight and back straight).
 *
 * Coordinates are in metres, X = east, Z = south. The track lives at world Y=0.
 */
export const CIRCUIT_CONTROL_POINTS: ReadonlyArray<readonly [number, number]> = [
  // 0  Start/finish — middle of the long pit straight
  [-110, 70],
  // 1  End of pit straight, braking
  [10, 70],
  // 2  Turn 1 — tight right
  [60, 55],
  // 3  Short chute heading south-east
  [90, 25],
  // 4  Turn 3 — medium left
  [80, -15],
  // 5  Esses A — right
  [105, -40],
  // 6  Esses B — left
  [130, -25],
  // 7  Esses C — right, leading onto back straight
  [155, 0],
  // 8  Turn 7 — looping right
  [165, 40],
  // 9  Back straight braking zone
  [140, 80],
  // 10 Turn 8 — into hairpin
  [110, 120],
  // 11 Turn 9 — HAIRPIN apex
  [80, 145],
  // 12 Hairpin exit, heading west
  [40, 130],
  // 13 Turn 10 — medium left
  [-30, 140],
  // 14 Turn 11 — fast right kink
  [-100, 130],
  // 15 Final corner — long left onto pit straight
  [-160, 105],
];

/**
 * Build the closed Catmull-Rom centerline from the control points.
 * Tension 0.5 (default) gives a natural racing-line feel.
 */
export function createCenterline(): THREE.CatmullRomCurve3 {
  const pts = CIRCUIT_CONTROL_POINTS.map(
    ([x, z]) => new THREE.Vector3(x, 0, z),
  );
  const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
  return curve;
}

/** Half-width of the racing surface in metres (full width ~18 m). */
export const TRACK_HALF_WIDTH = 9.0;

/** Width of each kerb strip in metres. */
export const KERB_WIDTH = 2.0;

/** Number of samples taken along the centerline for the ribbon mesh. */
export const TRACK_SEGMENTS = 256;

/** Number of evenly spaced checkpoint sensors (including start/finish). */
export const CHECKPOINT_COUNT = 20;
