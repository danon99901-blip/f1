import { describe, it, expect, beforeEach } from 'vitest';

interface ERSState {
  charge: number;
  maxCharge: number;
  deployRate: number;
  recoveryRate: number;
  isDeploying: boolean;
  isRecovering: boolean;
}

interface ERSSystem {
  getState(): ERSState;
  deploy(dt: number): number;
  recover(brakingForce: number, dt: number): void;
  update(dt: number): void;
  reset(): void;
}

class ERS implements ERSSystem {
  private charge: number;
  private readonly maxCharge: number;
  private readonly deployRate: number;
  private readonly recoveryRate: number;
  private isDeploying: boolean;
  private isRecovering: boolean;

  constructor(
    maxCharge: number = 4000000,
    deployRate: number = 120000,
    recoveryRate: number = 80000,
  ) {
    this.charge = maxCharge;
    this.maxCharge = maxCharge;
    this.deployRate = deployRate;
    this.recoveryRate = recoveryRate;
    this.isDeploying = false;
    this.isRecovering = false;
  }

  getState(): ERSState {
    return {
      charge: this.charge,
      maxCharge: this.maxCharge,
      deployRate: this.deployRate,
      recoveryRate: this.recoveryRate,
      isDeploying: this.isDeploying,
      isRecovering: this.isRecovering,
    };
  }

  deploy(dt: number): number {
    if (this.charge <= 0) {
      this.isDeploying = false;
      return 0;
    }

    const energyToUse = Math.min(this.charge, this.deployRate * dt);
    this.charge -= energyToUse;
    this.isDeploying = true;

    const powerBoost = energyToUse / dt;
    return powerBoost;
  }

  recover(brakingForce: number, dt: number): void {
    if (this.charge >= this.maxCharge) {
      this.isRecovering = false;
      return;
    }

    const efficiency = 0.65;
    const recoveredEnergy = Math.min(
      this.maxCharge - this.charge,
      brakingForce * efficiency * dt,
      this.recoveryRate * dt,
    );

    this.charge += recoveredEnergy;
    this.isRecovering = recoveredEnergy > 0;
  }

  update(_dt: number): void {
    this.charge = Math.max(0, Math.min(this.maxCharge, this.charge));
    this.isDeploying = false;
    this.isRecovering = false;
  }

  reset(): void {
    this.charge = this.maxCharge;
    this.isDeploying = false;
    this.isRecovering = false;
  }
}

describe('ERS (Energy Recovery System)', () => {
  let ers: ERSSystem;

  beforeEach(() => {
    ers = new ERS();
  });

  describe('initialization', () => {
    it('should initialize with full charge', () => {
      const state = ers.getState();
      expect(state.charge).toBe(state.maxCharge);
      expect(state.charge).toBe(4000000);
    });

    it('should initialize with correct rates', () => {
      const state = ers.getState();
      expect(state.deployRate).toBe(120000);
      expect(state.recoveryRate).toBe(80000);
    });

    it('should not be deploying or recovering initially', () => {
      const state = ers.getState();
      expect(state.isDeploying).toBe(false);
      expect(state.isRecovering).toBe(false);
    });

    it('should accept custom parameters', () => {
      const customERS = new ERS(5000000, 150000, 100000);
      const state = customERS.getState();
      expect(state.maxCharge).toBe(5000000);
      expect(state.deployRate).toBe(150000);
      expect(state.recoveryRate).toBe(100000);
    });
  });

  describe('deploy', () => {
    it('should provide power boost when deploying', () => {
      const dt = 1 / 60;
      const powerBoost = ers.deploy(dt);

      expect(powerBoost).toBeGreaterThan(0);
      expect(powerBoost).toBeLessThanOrEqual(120000);
    });

    it('should reduce charge when deploying', () => {
      const initialCharge = ers.getState().charge;
      const dt = 1 / 60;

      ers.deploy(dt);

      const finalCharge = ers.getState().charge;
      expect(finalCharge).toBeLessThan(initialCharge);
    });

    it('should set isDeploying flag', () => {
      ers.deploy(1 / 60);
      expect(ers.getState().isDeploying).toBe(true);
    });

    it('should return zero power when charge is depleted', () => {
      const dt = 1 / 60;

      for (let i = 0; i < 2500; i++) {
        ers.deploy(dt);
      }

      const powerBoost = ers.deploy(dt);
      expect(powerBoost).toBe(0);
      expect(ers.getState().charge).toBe(0);
    });

    it('should not deploy below zero charge', () => {
      const dt = 1 / 60;

      for (let i = 0; i < 3000; i++) {
        ers.deploy(dt);
      }

      const state = ers.getState();
      expect(state.charge).toBeGreaterThanOrEqual(0);
    });

    it('should respect deploy rate limit', () => {
      const dt = 1.0;
      const powerBoost = ers.deploy(dt);

      expect(powerBoost).toBeLessThanOrEqual(120000);
    });

    it('should calculate power boost correctly', () => {
      const dt = 1 / 60;
      const expectedEnergyUsed = Math.min(ers.getState().charge, 120000 * dt);
      const expectedPower = expectedEnergyUsed / dt;

      const actualPower = ers.deploy(dt);

      expect(actualPower).toBeCloseTo(expectedPower, 1);
    });
  });

  describe('recover', () => {
    it('should recover energy when braking', () => {
      ers.deploy(1 / 60);
      ers.deploy(1 / 60);

      const chargeBeforeRecovery = ers.getState().charge;
      ers.recover(5000, 1 / 60);

      const chargeAfterRecovery = ers.getState().charge;
      expect(chargeAfterRecovery).toBeGreaterThan(chargeBeforeRecovery);
    });

    it('should set isRecovering flag', () => {
      ers.deploy(1 / 60);
      ers.recover(5000, 1 / 60);

      expect(ers.getState().isRecovering).toBe(true);
    });

    it('should not recover beyond max charge', () => {
      const maxCharge = ers.getState().maxCharge;

      for (let i = 0; i < 100; i++) {
        ers.recover(10000, 1 / 60);
      }

      expect(ers.getState().charge).toBeLessThanOrEqual(maxCharge);
    });

    it('should respect recovery rate limit', () => {
      ers.deploy(1 / 60);
      ers.deploy(1 / 60);

      const chargeBefore = ers.getState().charge;
      const dt = 1.0;
      ers.recover(1000000, dt);

      const chargeGained = ers.getState().charge - chargeBefore;
      expect(chargeGained).toBeLessThanOrEqual(80000 * dt);
    });

    it('should apply efficiency factor', () => {
      const customERS = new ERS(4000000, 120000, 80000);

      for (let i = 0; i < 50; i++) {
        customERS.deploy(1 / 60);
      }

      const chargeBefore = customERS.getState().charge;
      const brakingForce = 10000;
      const dt = 1 / 60;
      const efficiency = 0.65;

      customERS.recover(brakingForce, dt);

      const chargeGained = customERS.getState().charge - chargeBefore;
      const maxPossibleRecovery = brakingForce * efficiency * dt;

      expect(chargeGained).toBeCloseTo(maxPossibleRecovery, 1);
    });

    it('should not recover when at full charge', () => {
      const maxCharge = ers.getState().maxCharge;

      ers.recover(10000, 1 / 60);

      expect(ers.getState().charge).toBe(maxCharge);
      expect(ers.getState().isRecovering).toBe(false);
    });
  });

  describe('update', () => {
    it('should clamp charge to valid range', () => {
      ers.update(1 / 60);

      const state = ers.getState();
      expect(state.charge).toBeGreaterThanOrEqual(0);
      expect(state.charge).toBeLessThanOrEqual(state.maxCharge);
    });

    it('should reset deployment flags when not actively deploying', () => {
      ers.deploy(1 / 60);
      ers.update(1 / 60);

      const state = ers.getState();
      expect(state.isDeploying).toBe(false);
    });

    it('should reset recovery flags when not actively recovering', () => {
      ers.deploy(1 / 60);
      ers.recover(5000, 1 / 60);
      ers.update(1 / 60);

      const state = ers.getState();
      expect(state.isRecovering).toBe(false);
    });
  });

  describe('reset', () => {
    it('should restore full charge', () => {
      for (let i = 0; i < 100; i++) {
        ers.deploy(1 / 60);
      }

      ers.reset();

      const state = ers.getState();
      expect(state.charge).toBe(state.maxCharge);
    });

    it('should clear deployment flag', () => {
      ers.deploy(1 / 60);
      ers.reset();

      expect(ers.getState().isDeploying).toBe(false);
    });

    it('should clear recovery flag', () => {
      ers.deploy(1 / 60);
      ers.recover(5000, 1 / 60);
      ers.reset();

      expect(ers.getState().isRecovering).toBe(false);
    });
  });

  describe('integration scenarios', () => {
    it('should handle full deploy and recovery cycle', () => {
      const initialCharge = ers.getState().charge;

      for (let i = 0; i < 100; i++) {
        ers.deploy(1 / 60);
      }

      const chargeAfterDeploy = ers.getState().charge;
      expect(chargeAfterDeploy).toBeLessThan(initialCharge);

      for (let i = 0; i < 100; i++) {
        ers.recover(8000, 1 / 60);
      }

      const chargeAfterRecovery = ers.getState().charge;
      expect(chargeAfterRecovery).toBeGreaterThan(chargeAfterDeploy);
    });

    it('should handle rapid deploy/recover switching', () => {
      for (let i = 0; i < 50; i++) {
        ers.deploy(1 / 60);
        ers.recover(5000, 1 / 60);
      }

      const state = ers.getState();
      expect(state.charge).toBeGreaterThanOrEqual(0);
      expect(state.charge).toBeLessThanOrEqual(state.maxCharge);
    });

    it('should provide consistent power over multiple frames', () => {
      const powers: number[] = [];

      for (let i = 0; i < 10; i++) {
        powers.push(ers.deploy(1 / 60));
      }

      const avgPower = powers.reduce((a, b) => a + b, 0) / powers.length;
      expect(avgPower).toBeGreaterThan(0);

      for (const power of powers) {
        expect(power).toBeCloseTo(avgPower, -3);
      }
    });

    it('should handle zero braking force gracefully', () => {
      ers.deploy(1 / 60);
      const chargeBefore = ers.getState().charge;

      ers.recover(0, 1 / 60);

      expect(ers.getState().charge).toBe(chargeBefore);
    });

    it('should handle very small time steps', () => {
      const dt = 0.001;
      const powerBoost = ers.deploy(dt);

      expect(powerBoost).toBeGreaterThanOrEqual(0);
      expect(ers.getState().charge).toBeLessThanOrEqual(ers.getState().maxCharge);
    });

    it('should maintain charge conservation', () => {
      const initialCharge = ers.getState().charge;

      const powerBoost = ers.deploy(1 / 60);
      const energyUsed = powerBoost * (1 / 60);

      const expectedCharge = initialCharge - energyUsed;
      expect(ers.getState().charge).toBeCloseTo(expectedCharge, 1);
    });
  });

  describe('edge cases', () => {
    it('should handle zero time step', () => {
      const chargeBefore = ers.getState().charge;
      ers.deploy(0);
      expect(ers.getState().charge).toBe(chargeBefore);
    });

    it('should handle negative braking force', () => {
      const chargeBefore = ers.getState().charge;
      ers.recover(-1000, 1 / 60);
      expect(ers.getState().charge).toBe(chargeBefore);
    });

    it('should handle very large time steps', () => {
      const dt = 10.0;
      ers.deploy(dt);

      expect(ers.getState().charge).toBeGreaterThanOrEqual(0);
    });

    it('should handle deployment when nearly empty', () => {
      for (let i = 0; i < 2400; i++) {
        ers.deploy(1 / 60);
      }

      const powerBoost = ers.deploy(1 / 60);
      expect(powerBoost).toBeGreaterThanOrEqual(0);
    });

    it('should handle recovery when nearly full', () => {
      ers.deploy(1 / 60);

      for (let i = 0; i < 100; i++) {
        ers.recover(10000, 1 / 60);
      }

      const state = ers.getState();
      expect(state.charge).toBe(state.maxCharge);
    });
  });
});
