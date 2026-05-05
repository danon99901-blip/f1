/**
 * ERS (Energy Recovery System) for F1 car
 *
 * Real F1 regulations (simplified):
 * - MGU-K max power: 120 kW (160 hp) deployment
 * - MGU-K max recovery: 120 kW during braking
 * - Battery capacity: 4 MJ per lap
 * - Max deployment per lap: 4 MJ (33.3 seconds at full power)
 * - Automatic recovery during braking
 */

export interface ERSState {
  /** Current battery charge in Joules (0 to maxCapacity) */
  batteryCharge: number;
  /** Maximum battery capacity in Joules */
  maxCapacity: number;
  /** Energy deployed this lap in Joules */
  deployedThisLap: number;
  /** Energy recovered this lap in Joules */
  recoveredThisLap: number;
  /** Is deployment currently active */
  isDeploying: boolean;
  /** Is recovery currently active */
  isRecovering: boolean;
  /** Battery charge percentage (0-100) */
  chargePercent: number;
}

export class ERS {
  // F1 regulations
  private static readonly MAX_POWER_DEPLOY = 120000; // 120 kW
  private static readonly MAX_POWER_RECOVER = 120000; // 120 kW
  private static readonly MAX_CAPACITY = 4000000; // 4 MJ
  private static readonly MAX_DEPLOY_PER_LAP = 4000000; // 4 MJ

  private batteryCharge: number;
  private deployedThisLap: number;
  private recoveredThisLap: number;
  private isDeploying: boolean;
  private isRecovering: boolean;

  constructor(initialCharge: number = ERS.MAX_CAPACITY) {
    this.batteryCharge = Math.min(initialCharge, ERS.MAX_CAPACITY);
    this.deployedThisLap = 0;
    this.recoveredThisLap = 0;
    this.isDeploying = false;
    this.isRecovering = false;
  }

  /**
   * Update ERS system
   * @param dt Delta time in seconds
   * @param throttle Throttle input (0-1)
   * @param brake Brake input (0-1)
   * @param speed Current speed in m/s
   * @param deployRequested Driver requests deployment (e.g., overtake button)
   * @returns Additional thrust force in Newtons
   */
  update(
    dt: number,
    throttle: number,
    brake: number,
    speed: number,
    deployRequested: boolean,
  ): number {
    this.isDeploying = false;
    this.isRecovering = false;

    // Recovery during braking
    if (brake > 0.1 && speed > 5) {
      const recoveryPower = ERS.MAX_POWER_RECOVER * brake;
      const energyRecovered = recoveryPower * dt;

      if (this.batteryCharge < ERS.MAX_CAPACITY) {
        const actualRecovery = Math.min(
          energyRecovered,
          ERS.MAX_CAPACITY - this.batteryCharge,
        );
        this.batteryCharge += actualRecovery;
        this.recoveredThisLap += actualRecovery;
        this.isRecovering = true;
      }
    }

    // Deployment when requested and conditions met
    let deploymentForce = 0;
    if (
      deployRequested &&
      throttle > 0.5 &&
      this.batteryCharge > 0 &&
      this.deployedThisLap < ERS.MAX_DEPLOY_PER_LAP
    ) {
      const deployPower = ERS.MAX_POWER_DEPLOY;
      const energyToUse = deployPower * dt;

      const availableEnergy = Math.min(
        this.batteryCharge,
        ERS.MAX_DEPLOY_PER_LAP - this.deployedThisLap,
      );

      if (availableEnergy > 0) {
        const actualDeployment = Math.min(energyToUse, availableEnergy);
        this.batteryCharge -= actualDeployment;
        this.deployedThisLap += actualDeployment;
        this.isDeploying = true;

        // Convert power to force: P = F * v => F = P / v
        // At low speeds, cap the force to prevent unrealistic acceleration
        const minSpeed = 10; // m/s
        const effectiveSpeed = Math.max(speed, minSpeed);
        deploymentForce = deployPower / effectiveSpeed;
      }
    }

    return deploymentForce;
  }

  /**
   * Reset lap counters (call at start of new lap)
   */
  resetLapCounters(): void {
    this.deployedThisLap = 0;
    this.recoveredThisLap = 0;
  }

  /**
   * Get current ERS state for UI/telemetry
   */
  getState(): ERSState {
    return {
      batteryCharge: this.batteryCharge,
      maxCapacity: ERS.MAX_CAPACITY,
      deployedThisLap: this.deployedThisLap,
      recoveredThisLap: this.recoveredThisLap,
      isDeploying: this.isDeploying,
      isRecovering: this.isRecovering,
      chargePercent: (this.batteryCharge / ERS.MAX_CAPACITY) * 100,
    };
  }

  /**
   * Get remaining deployment available this lap (in Joules)
   */
  getRemainingDeployment(): number {
    return Math.max(0, ERS.MAX_DEPLOY_PER_LAP - this.deployedThisLap);
  }

  /**
   * Check if deployment is available
   */
  canDeploy(): boolean {
    return (
      this.batteryCharge > 0 &&
      this.deployedThisLap < ERS.MAX_DEPLOY_PER_LAP
    );
  }

  /**
   * Manually set battery charge (for testing/setup)
   */
  setBatteryCharge(charge: number): void {
    this.batteryCharge = Math.max(0, Math.min(charge, ERS.MAX_CAPACITY));
  }
}
