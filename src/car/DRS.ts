/**
 * DRS (Drag Reduction System) for F1 car
 *
 * Real F1 regulations:
 * - Can only be activated in designated DRS zones
 * - Must be within 1 second of car ahead at detection point
 * - Reduces drag by ~10-15% when rear wing flap opens
 * - Automatically disabled when braking
 * - Adds ~10-15 km/h top speed on straights
 */

export interface DRSState {
  /** Is DRS currently active (wing open) */
  isActive: boolean;
  /** Is DRS available to use */
  isAvailable: boolean;
  /** Is car currently in a DRS zone */
  inDRSZone: boolean;
  /** Drag reduction multiplier (1.0 = normal, 0.85 = DRS active) */
  dragMultiplier: number;
}

export class DRS {
  // DRS effect on drag (15% reduction when active)
  private static readonly DRAG_REDUCTION = 0.85;
  private static readonly ACTIVATION_SPEED_MIN = 30; // m/s (~108 km/h)

  private isActive: boolean;
  private isAvailable: boolean;
  private inDRSZone: boolean;
  private forceDisabled: boolean;

  constructor() {
    this.isActive = false;
    this.isAvailable = false;
    this.inDRSZone = false;
    this.forceDisabled = false;
  }

  /**
   * Update DRS system
   * @param speed Current speed in m/s
   * @param brake Brake input (0-1)
   * @param inZone Is car in DRS zone
   * @param withinGap Is car within 1s of car ahead (for multiplayer)
   * @param drsRequested Driver requests DRS activation
   * @returns Drag multiplier (1.0 = normal, 0.85 = DRS active)
   */
  update(
    speed: number,
    brake: number,
    inZone: boolean,
    withinGap: boolean,
    drsRequested: boolean,
  ): number {
    this.inDRSZone = inZone;

    // If force disabled, DRS is not available
    if (this.forceDisabled) {
      this.isAvailable = false;
      this.isActive = false;
      return 1.0;
    }

    // DRS availability: in zone, within gap (or single player), above min speed
    this.isAvailable =
      inZone &&
      withinGap &&
      speed > DRS.ACTIVATION_SPEED_MIN;

    // DRS activation: available, requested, not braking
    const canActivate = this.isAvailable && drsRequested && brake < 0.1;

    // Automatically disable when braking or conditions not met
    if (brake > 0.1 || !this.isAvailable || !drsRequested) {
      this.isActive = false;
    } else if (canActivate) {
      this.isActive = true;
    }

    return this.isActive ? DRS.DRAG_REDUCTION : 1.0;
  }

  /**
   * Set DRS zone status (called by track/lap detection system)
   */
  setInZone(inZone: boolean): void {
    this.inDRSZone = inZone;
  }

  /**
   * Set DRS availability (for multiplayer gap detection)
   */
  setAvailable(available: boolean): void {
    this.isAvailable = available;
  }

  /**
   * Get current DRS state for UI/telemetry
   */
  getState(): DRSState {
    return {
      isActive: this.isActive,
      isAvailable: this.isAvailable,
      inDRSZone: this.inDRSZone,
      dragMultiplier: this.isActive ? DRS.DRAG_REDUCTION : 1.0,
    };
  }

  /**
   * Force DRS off (e.g., yellow flags, safety car)
   */
  forceDisable(): void {
    this.isActive = false;
    this.isAvailable = false;
    this.forceDisabled = true;
  }

  /**
   * Re-enable DRS after force disable
   */
  enable(): void {
    this.forceDisabled = false;
  }
}
