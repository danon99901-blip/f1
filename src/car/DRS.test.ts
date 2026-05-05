import { describe, it, expect, beforeEach } from 'vitest';
import { DRS } from './DRS';

describe('DRS', () => {
  let drs: DRS;

  beforeEach(() => {
    drs = new DRS();
  });

  describe('initialization', () => {
    it('should initialize with DRS inactive', () => {
      const state = drs.getState();
      expect(state.isActive).toBe(false);
      expect(state.isAvailable).toBe(false);
      expect(state.inDRSZone).toBe(false);
    });

    it('should have normal drag multiplier initially', () => {
      const state = drs.getState();
      expect(state.dragMultiplier).toBe(1.0);
    });
  });

  describe('DRS activation', () => {
    it('should activate when all conditions are met', () => {
      // In zone, within gap, above min speed, requested, not braking
      const dragMultiplier = drs.update(50, 0, true, true, true);

      const state = drs.getState();
      expect(state.isActive).toBe(true);
      expect(dragMultiplier).toBe(0.85);
    });

    it('should not activate below minimum speed', () => {
      // Below 30 m/s
      const dragMultiplier = drs.update(25, 0, true, true, true);

      const state = drs.getState();
      expect(state.isActive).toBe(false);
      expect(dragMultiplier).toBe(1.0);
    });

    it('should not activate outside DRS zone', () => {
      const dragMultiplier = drs.update(50, 0, false, true, true);

      const state = drs.getState();
      expect(state.isActive).toBe(false);
      expect(dragMultiplier).toBe(1.0);
    });

    it('should not activate without gap advantage', () => {
      const dragMultiplier = drs.update(50, 0, true, false, true);

      const state = drs.getState();
      expect(state.isActive).toBe(false);
      expect(dragMultiplier).toBe(1.0);
    });

    it('should not activate when not requested', () => {
      const dragMultiplier = drs.update(50, 0, true, true, false);

      const state = drs.getState();
      expect(state.isActive).toBe(false);
      expect(dragMultiplier).toBe(1.0);
    });
  });

  describe('DRS deactivation', () => {
    it('should deactivate when braking', () => {
      // Activate DRS first
      drs.update(50, 0, true, true, true);
      expect(drs.getState().isActive).toBe(true);

      // Apply brakes
      const dragMultiplier = drs.update(50, 0.5, true, true, true);

      const state = drs.getState();
      expect(state.isActive).toBe(false);
      expect(dragMultiplier).toBe(1.0);
    });

    it('should deactivate when leaving DRS zone', () => {
      // Activate DRS first
      drs.update(50, 0, true, true, true);
      expect(drs.getState().isActive).toBe(true);

      // Leave zone
      const dragMultiplier = drs.update(50, 0, false, true, true);

      const state = drs.getState();
      expect(state.isActive).toBe(false);
      expect(dragMultiplier).toBe(1.0);
    });

    it('should deactivate when request is released', () => {
      // Activate DRS first
      drs.update(50, 0, true, true, true);
      expect(drs.getState().isActive).toBe(true);

      // Release DRS button
      const dragMultiplier = drs.update(50, 0, true, true, false);

      const state = drs.getState();
      expect(state.isActive).toBe(false);
      expect(dragMultiplier).toBe(1.0);
    });
  });

  describe('DRS availability', () => {
    it('should be available in zone with gap advantage', () => {
      drs.update(50, 0, true, true, false);

      const state = drs.getState();
      expect(state.isAvailable).toBe(true);
    });

    it('should not be available outside zone', () => {
      drs.update(50, 0, false, true, false);

      const state = drs.getState();
      expect(state.isAvailable).toBe(false);
    });

    it('should not be available without gap advantage', () => {
      drs.update(50, 0, true, false, false);

      const state = drs.getState();
      expect(state.isAvailable).toBe(false);
    });

    it('should not be available below minimum speed', () => {
      drs.update(25, 0, true, true, false);

      const state = drs.getState();
      expect(state.isAvailable).toBe(false);
    });
  });

  describe('zone management', () => {
    it('should update zone status', () => {
      drs.setInZone(true);
      expect(drs.getState().inDRSZone).toBe(true);

      drs.setInZone(false);
      expect(drs.getState().inDRSZone).toBe(false);
    });

    it('should update availability status', () => {
      drs.setAvailable(true);
      expect(drs.getState().isAvailable).toBe(true);

      drs.setAvailable(false);
      expect(drs.getState().isAvailable).toBe(false);
    });
  });

  describe('force disable', () => {
    it('should force DRS off', () => {
      // Activate DRS first
      drs.update(50, 0, true, true, true);
      expect(drs.getState().isActive).toBe(true);

      // Force disable
      drs.forceDisable();

      const state = drs.getState();
      expect(state.isActive).toBe(false);
      expect(state.isAvailable).toBe(false);
    });

    it('should prevent activation after force disable', () => {
      drs.forceDisable();

      // Try to activate
      const dragMultiplier = drs.update(50, 0, true, true, true);

      const state = drs.getState();
      expect(state.isActive).toBe(false);
      expect(dragMultiplier).toBe(1.0);
    });
  });

  describe('drag reduction', () => {
    it('should reduce drag by 15% when active', () => {
      const dragMultiplier = drs.update(50, 0, true, true, true);
      expect(dragMultiplier).toBe(0.85);
    });

    it('should have normal drag when inactive', () => {
      const dragMultiplier = drs.update(50, 0, false, true, true);
      expect(dragMultiplier).toBe(1.0);
    });
  });

  describe('integration scenarios', () => {
    it('should handle rapid activation/deactivation', () => {
      for (let i = 0; i < 10; i++) {
        drs.update(50, 0, true, true, true);
        drs.update(50, 0.5, true, true, true); // Brake
      }

      const state = drs.getState();
      expect(state.isActive).toBe(false);
    });

    it('should maintain state across multiple updates', () => {
      // Activate and hold
      for (let i = 0; i < 10; i++) {
        const dragMultiplier = drs.update(50, 0, true, true, true);
        expect(dragMultiplier).toBe(0.85);
      }

      const state = drs.getState();
      expect(state.isActive).toBe(true);
    });

    it('should handle zone entry and exit', () => {
      // Enter zone
      drs.update(50, 0, true, true, true);
      expect(drs.getState().isActive).toBe(true);

      // Stay in zone
      drs.update(50, 0, true, true, true);
      expect(drs.getState().isActive).toBe(true);

      // Exit zone
      drs.update(50, 0, false, true, true);
      expect(drs.getState().isActive).toBe(false);
    });
  });
});
