// Physics constants extracted from vehicle.ts for shared use

// Chassis dimensions (half-extents)
export const CHASSIS_HX = 0.9;
export const CHASSIS_HY = 0.2;
export const CHASSIS_HZ = 2.25;
export const COM_OFFSET_Y = -0.4;

// Wheels
export const WHEEL_RADIUS = 0.34;
export const WHEEL_WIDTH = 0.32;
export const WHEEL_Y_OFFSET = -0.15;
export const WHEEL_HALF_TRACK = 0.85;
export const WHEEL_FRONT_Z = -1.55;
export const WHEEL_REAR_Z = 1.55;

// Suspension
export const SUSPENSION_REST_LENGTH = 0.32;
export const SUSPENSION_STIFFNESS = 55.0;
export const SUSPENSION_COMPRESSION = 6.5;
export const SUSPENSION_RELAXATION = 6.0;
export const MAX_SUSPENSION_TRAVEL = 0.20;
export const MAX_SUSPENSION_FORCE = 100000;

// Grip
export const FRICTION_SLIP = 3.2;
export const SIDE_FRICTION_STIFFNESS = 1.0;

// Drive / brake / steering
export const THRUST_FORWARD_MAX = 12000;
export const THRUST_REVERSE_MAX = 4500;
export const BRAKE_FRONT = 60;
export const BRAKE_REAR = 90;
export const HANDBRAKE_REAR = 200;
export const STEER_MAX = 0.55;
export const STEER_MIN = 0.12;
export const STEER_SPEED_FALLOFF = 60;
export const STEER_SMOOTH = 6.0;

// Speed limits
export const TOP_SPEED_FORWARD = 85;
export const TOP_SPEED_REVERSE = 18;

// Damping
export const CHASSIS_LINEAR_DAMPING = 0.08;
export const CHASSIS_ANGULAR_DAMPING = 1.6;

// Tyre model
export const TYRE_AMBIENT_C = 72;
export const TYRE_OPTIMAL_C = 95;
export const TYRE_TEMP_GAIN_LAT = 0.9;
export const TYRE_TEMP_GAIN_LONG = 0.6;
export const TYRE_TEMP_COOLING = 0.07;
export const TYRE_WEAR_RATE = 0.00002;

// Aero
export const DOWNFORCE_COEFF = 1.1;
export const DOWNFORCE_MAX = 6000;
export const DRAG_COEFF = 1.1;

// Network timing
export const TICK_RATE = 60;           // Physics simulation rate (Hz)
export const SNAPSHOT_RATE = 30;       // Network snapshot broadcast rate (Hz) — 30Hz for lower visible latency. Actual rate is set per-client via NetworkConfig based on measured ping.
// Number of snapshots to buffer for interpolation. At SNAPSHOT_RATE=20Hz with a 100ms
// render delay, the interpolator typically consumes 2 snapshots per frame; a buffer of
// 3 collapses to extrapolation almost immediately when packets are reordered or jitter
// spikes. 10 gives ~500ms of history at 20Hz — enough cushion for typical jitter without
// adding noticeable extra latency (render delay is unchanged).
export const SNAPSHOT_BUFFER_SIZE = 10;
export const INPUT_BUFFER_SIZE = 60;   // Number of inputs to keep for prediction (1 second)

// Game settings
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const LAP_OPTIONS = [3, 5, 10] as const;
export const DEFAULT_LAPS = 3;
