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
 * Control points for Circuit de Monaco — geometry traced from the real
 * street layout (OSM relation "Circuit de Monaco" + official FIA layout).
 *
 * Coordinate frame: X = east, Z = south, units = metres. The origin sits on
 * the start/finish line on Boulevard Albert Ier, with the racing direction
 * along +X (east), matching how the cars launch off the line.
 *
 * Total length ≈ 3337 m, 19 named corners. Walked clockwise (the real
 * direction of travel) from the start/finish line:
 *
 *   0..1   Start/finish straight along Boulevard Albert Ier
 *   2      T1  Sainte Devote        (tight right, ~80 km/h)
 *   3..6   Beau Rivage uphill ramp toward Casino
 *   7      T3  Massenet             (left, entry to Casino Square)
 *   8      T4  Casino Square        (right, crest)
 *   9..10  Run down to Mirabeau
 *   11     T5  Mirabeau Haute       (right, downhill)
 *   12..13 T6  Grand Hotel Hairpin / Loews (slowest corner, ~48 km/h)
 *   14     T7  Mirabeau Basse       (right, downhill)
 *   15     T8  Portier              (right, leads onto the tunnel)
 *   16..19 Tunnel section under the Fairmont (fastest part, ~290 km/h)
 *   20     T10 Nouvelle Chicane     (left/right chicane, harbour exit)
 *   21     T11 Tabac                (fast left along the harbour)
 *   22..23 T12 Swimming Pool entry  (left/right flick)
 *   24..25 T15 Swimming Pool exit   (right/left flick)
 *   26     T17 La Rascasse          (very tight right hairpin)
 *   27..29 T19 Anthony Noghes       (right onto start/finish)
 *
 * The shape is approximate to within a few metres but preserves the real
 * proportions (long pit straight, climb to Casino, the tunnel kink, the
 * harbour run, and the tight Rascasse / Anthony Noghes pairing).
 */
export const MONACO_CONTROL_POINTS: ReadonlyArray<readonly [number, number]> = [
  // 0  Start/finish line on Boulevard Albert Ier
  [0, 0],
  // 1  End of pit straight, braking for Sainte Devote
  [120, -8],
  // 2  T1  Sainte Devote — tight right, climb begins
  [148, -22],
  // 3  Beau Rivage — fast uphill kink (Avenue d'Ostende)
  [168, -52],
  // 4  Beau Rivage mid-climb
  [180, -90],
  // 5  Beau Rivage upper section
  [186, -130],
  // 6  Approach to Casino, road bends left
  [180, -168],
  // 7  T3  Massenet — left into Casino Square
  [160, -198],
  // 8  T4  Casino Square — right, crest of the circuit
  [128, -214],
  // 9  Down toward Mirabeau, Avenue des Beaux-Arts
  [92, -222],
  // 10 Approach to Mirabeau Haute
  [58, -218],
  // 11 T5  Mirabeau Haute — tight right, downhill
  [32, -204],
  // 12 Run-in to the Loews hairpin
  [18, -184],
  // 13 T6  Grand Hotel Hairpin (Loews) — slowest corner, ~180° right
  [44, -168],
  // 14 T7  Mirabeau Basse — right, continues downhill
  [62, -184],
  // 15 T8  Portier — right onto the seafront, tunnel entry
  [88, -222],
  // 16 Tunnel entrance (under the Fairmont)
  [112, -252],
  // 17 Tunnel mid (fastest point on the lap)
  [120, -288],
  // 18 Tunnel exit, slight left toward chicane braking zone
  [108, -322],
  // 19 Run-down from tunnel along Boulevard Louis II
  [82, -348],
  // 20 T10 Nouvelle Chicane — harbourside left/right
  [50, -362],
  // 21 T11 Tabac — fast left along the harbour
  [10, -360],
  // 22 T12 Swimming Pool entry — left flick
  [-26, -344],
  // 23 T13 Swimming Pool — right flick (between the pools)
  [-50, -316],
  // 24 T14 Swimming Pool — left
  [-72, -284],
  // 25 T15 Swimming Pool exit — right
  [-90, -252],
  // 26 Run-up to Rascasse
  [-104, -216],
  // 27 T17 La Rascasse — very tight right hairpin around the famous bar
  [-114, -178],
  // 28 Short run, slight left
  [-108, -140],
  // 29 T18 Anthony Noghes — right onto the pit straight
  [-92, -86],
  // 30 Apex of Anthony Noghes
  [-66, -42],
  // 31 Onto start/finish, blending back to point 0
  [-32, -16],
  // 32 Final approach to the line
  [-12, -4],
  // 33 Just before the start/finish (closes the loop)
  [-2, -1],
];

/**
 * Per-control-point elevation for Circuit de Monaco, in metres above sea
 * level. Indices line up 1:1 with `MONACO_CONTROL_POINTS`.
 *
 * Values are normalised so the start/finish line sits at Y=0 — the actual
 * altitude difference between the highest point (Casino Square, ~42 m) and
 * the lowest (harbour-side at Tabac/Nouvelle Chicane, ~5 m below the line)
 * is what we care about for racing feel. Elevation profile based on the
 * documented ~42 m climb from Sainte Devote to Casino, the steep descent
 * through Mirabeau / Loews / Portier, the level harbour section, and the
 * gentle rise back through Anthony Noghes.
 *
 * These are applied to the *frames* generated from the centerline, not to
 * the control points themselves — keeping the Catmull-Rom curve on the Y=0
 * plane (so existing tests and tangent math continue to work) while the
 * track ribbon and barriers are lifted into 3D after sampling.
 */
export const MONACO_ELEVATIONS: ReadonlyArray<number> = [
  // 0  Start/finish (datum)
  0.0,
  // 1  End of pit straight
  1.5,
  // 2  Sainte Devote — climb begins
  4.0,
  // 3  Beau Rivage lower
  12.0,
  // 4  Beau Rivage mid
  22.0,
  // 5  Beau Rivage upper
  32.0,
  // 6  Approach Casino
  38.0,
  // 7  Massenet
  41.0,
  // 8  Casino Square (highest point)
  42.0,
  // 9  Past Casino, gentle descent
  40.0,
  // 10 Approach Mirabeau
  37.0,
  // 11 Mirabeau Haute
  33.0,
  // 12 Run-in to Loews
  28.0,
  // 13 Loews hairpin
  24.0,
  // 14 Mirabeau Basse (downhill)
  19.0,
  // 15 Portier (sea level approach)
  10.0,
  // 16 Tunnel entrance
  6.0,
  // 17 Tunnel mid (under hill, but road is roughly level)
  6.0,
  // 18 Tunnel exit
  5.0,
  // 19 Run to chicane
  4.0,
  // 20 Nouvelle Chicane (harbour)
  3.5,
  // 21 Tabac
  3.5,
  // 22 Swimming Pool entry
  4.0,
  // 23 Swimming Pool mid 1
  4.5,
  // 24 Swimming Pool mid 2
  5.0,
  // 25 Swimming Pool exit
  5.5,
  // 26 Run-up to Rascasse
  6.0,
  // 27 Rascasse
  6.5,
  // 28 Past Rascasse
  5.0,
  // 29 Anthony Noghes
  3.5,
  // 30 Anthony Noghes apex
  2.5,
  // 31 Onto pit straight
  1.5,
  // 32 Final approach
  0.5,
  // 33 Just before line (closes the loop back to 0)
  0.1,
];

/**
 * Build Monaco circuit centerline.
 *
 * The control points stay on the Y=0 plane (so tangent / right-vector math
 * in `buildFrames` is unaffected). Elevations are applied separately by the
 * track builder via `MONACO_ELEVATIONS`.
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

/**
 * DRS zone definition: start and end positions along the track (0..1).
 * Detection point is typically ~100m before the zone start.
 */
export interface DRSZone {
  /** Detection point (0..1 along track) - where gap is measured */
  detectionPoint: number;
  /** Zone start (0..1 along track) - where DRS can be activated */
  zoneStart: number;
  /** Zone end (0..1 along track) - where DRS is disabled */
  zoneEnd: number;
  /** Human-readable name for the zone */
  name: string;
}

/**
 * DRS zones for default circuit.
 * Zone 1: Back straight (after hairpin)
 * Zone 2: Pit straight (main straight)
 */
export const DEFAULT_DRS_ZONES: ReadonlyArray<DRSZone> = [
  {
    name: 'Back Straight',
    detectionPoint: 0.65, // Hairpin exit
    zoneStart: 0.70,      // Start of back straight
    zoneEnd: 0.85,        // End of back straight
  },
  {
    name: 'Pit Straight',
    detectionPoint: 0.92, // Final corner exit
    zoneStart: 0.0,       // Start/finish line
    zoneEnd: 0.15,        // Turn 1 braking zone
  },
];

/**
 * DRS zones for Silverstone circuit.
 * Zone 1: Wellington Straight (main straight)
 * Zone 2: Hangar Straight (between Brooklands and Copse)
 */
export const SILVERSTONE_DRS_ZONES: ReadonlyArray<DRSZone> = [
  {
    name: 'Wellington Straight',
    detectionPoint: 0.90, // Club corner exit
    zoneStart: 0.0,       // Start/finish
    zoneEnd: 0.12,        // Abbey braking
  },
  {
    name: 'Hangar Straight',
    detectionPoint: 0.48, // Brooklands exit
    zoneStart: 0.52,      // Start of straight
    zoneEnd: 0.65,        // Copse braking
  },
];

/**
 * DRS zones for Monaco circuit.
 * Only one DRS zone on the main straight (Monaco has limited overtaking opportunities).
 */
export const MONACO_DRS_ZONES: ReadonlyArray<DRSZone> = [
  {
    name: 'Start/Finish Straight',
    detectionPoint: 0.88, // Rascasse exit
    zoneStart: 0.0,       // Start/finish
    zoneEnd: 0.08,        // Sainte Dévote braking
  },
];
