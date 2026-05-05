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
 * Control points for Silverstone-inspired circuit (18 corners).
 * More technical layout with faster flowing sections.
 */
export const SILVERSTONE_CONTROL_POINTS: ReadonlyArray<readonly [number, number]> = [
  // 0  Start/finish — Wellington Straight
  [-120, 60],
  // 1  Abbey — fast right
  [-40, 50],
  // 2  Farm Curve — medium left
  [0, 20],
  // 3  Village — tight right-left chicane entry
  [20, -10],
  // 4  Village chicane exit
  [35, -30],
  // 5  The Loop — long right
  [60, -50],
  // 6  Aintree — medium left
  [90, -40],
  // 7  Brooklands — heavy braking hairpin entry
  [120, -20],
  // 8  Brooklands apex
  [135, 10],
  // 9  Luffield — medium right
  [130, 45],
  // 10 Woodcote — fast right onto straight
  [110, 75],
  // 11 Copse — fast right
  [70, 95],
  // 12 Maggotts — fast left kink
  [30, 110],
  // 13 Becketts — fast right
  [0, 130],
  // 14 Chapel — fast left
  [-30, 145],
  // 15 Stowe — medium speed right
  [-70, 150],
  // 16 Vale — tight left
  [-110, 135],
  // 17 Club — medium right onto Wellington
  [-140, 100],
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

/**
 * Build Silverstone circuit centerline.
 */
export function createSilverstoneCircuit(): THREE.CatmullRomCurve3 {
  const pts = SILVERSTONE_CONTROL_POINTS.map(
    ([x, z]) => new THREE.Vector3(x, 0, z),
  );
  const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
  return curve;
}

/**
 * Control points for Monaco street circuit — accurate replica based on real track layout.
 * 3.337 km, 19 corners, tight and technical with elevation changes.
 * Scale: ~1 unit = 10 meters for proper racing feel.
 */
export const MONACO_CONTROL_POINTS: ReadonlyArray<readonly [number, number]> = [
  // Start/Finish straight
  [0, 0],
  [0, -20],

  // Turn 1: Sainte Dévote (tight right-hander, 50 km/h)
  [15, -35],
  [35, -45],

  // Beau Rivage (uphill climb to Casino)
  [50, -50],
  [70, -55],

  // Turn 2: Massenet (slight right kink)
  [85, -60],

  // Turn 3: Casino Square (right-hander)
  [100, -70],
  [110, -85],

  // Turn 4: Mirabeau (tight right before hairpin)
  [115, -100],

  // Turn 5: Grand Hotel Hairpin / Loews (slowest corner, 48 km/h)
  [115, -120],
  [105, -135],
  [85, -140],

  // Turn 6: Portier (right-hander leading to tunnel)
  [70, -145],
  [55, -155],

  // Tunnel section (slight left, fastest part ~260 km/h)
  [35, -165],
  [10, -175],
  [-15, -180],
  [-40, -182],

  // Turn 10: Nouvelle Chicane (left-right chicane after tunnel)
  [-60, -180],
  [-75, -175],
  [-85, -165],

  // Turn 11: Tabac (fast left-hander)
  [-95, -145],
  [-100, -120],

  // Turn 12-13: Swimming Pool complex (tight chicane)
  [-105, -95],
  [-115, -75],
  [-120, -55],
  [-115, -35],

  // Turn 14: La Rascasse (very tight hairpin, 55 km/h)
  [-105, -15],
  [-85, -5],

  // Turn 15: Anthony Noghes (tight right onto start/finish)
  [-65, 0],
  [-45, 5],
  [-25, 8],
  [-10, 5],
];

/**
 * Build Monaco circuit centerline.
 */
export function createMonacoCircuit(): THREE.CatmullRomCurve3 {
  const pts = MONACO_CONTROL_POINTS.map(
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
