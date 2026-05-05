import { describe, it, expect, beforeEach } from 'vitest';
import { ERS } from './ERS';

describe('ERS', () => {
  let ers: ERS;

  beforeEach(() => {
    ers = new ERS(4000000); // Full charge
  });

  describe('initialization', () => {
    it('should initialize with full charge', () => {
      const state = ers.getState();
      expect(state.batteryCharge).toBe(4000000);
      expect(state.chargePercent).toBe(100);
    });

    it('should cap initial charge at max capacity', () => {
      const ers2 = new ERS(5000000);
      const state = ers2.getState();
      expect(state.batteryCharge).toBe(4000000);
    });
  });

  describe('energy recovery', () => {
    it('should recover energy during braking', () => {
      ers.setBatteryCharge(2000000); // 50% charge
      const initialCharge = ers.getState().batteryCharge;

      // Brake for 1 second at 50 m/s
      ers.update(1.0, 0, 0.8, 50, false);

      const state = ers.getState();
      expect(state.batteryCharge).toBeGreaterThan(initialCharge);
      expect(state.isRecovering).toBe(true);
    });

    it('should not recover when battery is full', () => {
      const initialCharge = ers.getState().batteryCharge;

      // Try to recover with full battery
      ers.update(1.0, 0, 0.8, 50, false);

      const state = ers.getState();
      expect(state.batteryCharge).toBe(initialCharge);
      expect(state.isRecovering).toBe(false);
    });

    it('should not recover at low speeds', () => {
      ers.setBatteryCharge(2000000);
      const initialCharge = ers.getState().batteryCharge;

      // Brake at very low speed
      ers.update(1.0, 0, 0.8, 3, false);

      const state = ers.getState();
      expect(state.batteryCharge).toBe(initialCharge);
    });
  });

  describe('energy deployment', () => {
    it('should deploy energy when requested', () => {
      const initialCharge = ers.getState().batteryCharge;

      // Deploy for 1 second at 50 m/s with full throttle
      const force = ers.update(1.0, 1.0, 0, 50, true);

      const state = ers.getState();
      expect(state.batteryCharge).toBeLessThan(initialCharge);
      expect(state.isDeploying).toBe(true);
      expect(force).toBeGreaterThan(0);
    });

    it('should not deploy without throttle', () => {
      const initialCharge = ers.getState().batteryCharge;

      // Request deployment but no throttle
      const force = ers.update(1.0, 0, 0, 50, true);

      const state = ers.getState();
      expect(state.batteryCharge).toBe(initialCharge);
      expect(state.isDeploying).toBe(false);
      expect(force).toBe(0);
    });

    it('should not deploy when battery is empty', () => {
      ers.setBatteryCharge(0);

      const force = ers.update(1.0, 1.0, 0, 50, true);

      const state = ers.getState();
      expect(state.isDeploying).toBe(false);
      expect(force).toBe(0);
    });

    it('should respect per-lap deployment limit', () => {
      // Deploy maximum allowed per lap
      for (let i = 0; i < 40; i++) {
        ers.update(1.0, 1.0, 0, 50, true);
      }

      const state = ers.getState();
      expect(state.deployedThisLap).toBeCloseTo(4000000, -3);
      expect(ers.canDeploy()).toBe(false);
    });
  });

  describe('lap reset', () => {
    it('should reset lap counters', () => {
      // Deploy and recover some energy
      ers.update(1.0, 1.0, 0, 50, true);
      ers.update(1.0, 0, 0.8, 50, false);

      let state = ers.getState();
      expect(state.deployedThisLap).toBeGreaterThan(0);
      expect(state.recoveredThisLap).toBeGreaterThan(0);

      // Reset lap
      ers.resetLapCounters();

      state = ers.getState();
      expect(state.deployedThisLap).toBe(0);
      expect(state.recoveredThisLap).toBe(0);
    });
  });

  describe('state queries', () => {
    it('should report correct charge percentage', () => {
      ers.setBatteryCharge(2000000); // 50%
      const state = ers.getState();
      expect(state.chargePercent).toBe(50);
    });

    it('should calculate remaining deployment', () => {
      ers.update(1.0, 1.0, 0, 50, true); // Deploy some energy
      const remaining = ers.getRemainingDeployment();
      expect(remaining).toBeLessThan(4000000);
      expect(remaining).toBeGreaterThan(0);
    });

    it('should report deployment availability', () => {
      expect(ers.canDeploy()).toBe(true);

      ers.setBatteryCharge(0);
      expect(ers.canDeploy()).toBe(false);
    });
  });
});
