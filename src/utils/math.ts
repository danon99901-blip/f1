/**
 * Wraps a value to the range [0, length) with proper handling of negative values.
 * Useful for closed-loop distances and angles.
 */
export function wrapDistance(value: number, length: number): number {
  return ((value % length) + length) % length;
}

/**
 * Computes the exponential decay blend factor for smooth interpolation.
 * Returns a value in [0, 1] that can be used as: current + (target - current) * blend
 *
 * @param rate - Decay rate (higher = faster convergence)
 * @param dt - Time delta in seconds
 */
export function expDecayBlend(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/**
 * Converts a forward tangent vector (in XZ plane) to a yaw angle in radians.
 * Assumes the tangent points in the direction of travel with Y=0.
 */
export function tangentToYaw(tangentX: number, tangentZ: number): number {
  return Math.atan2(-tangentX, -tangentZ);
}
