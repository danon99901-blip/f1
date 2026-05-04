import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdaptiveTickRate } from './AdaptiveTickRate';

describe('AdaptiveTickRate', () => {
  let tickRate: AdaptiveTickRate;
  let mockTime: number;

  beforeEach(() => {
    mockTime = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => mockTime);
    tickRate = new AdaptiveTickRate();
  });

  describe('initialization', () => {
    it('should start at target Hz', () => {
      expect(tickRate.getCurrentHz()).toBe(30);
      expect(tickRate.getTargetHz()).toBe(30);
    });

    it('should accept custom config', () => {
      const custom = new AdaptiveTickRate({
        minHz: 10,
        maxHz: 120,
        targetHz: 60,
      });

      expect(custom.getCurrentHz()).toBe(60);
      expect(custom.getConfig().minHz).toBe(10);
      expect(custom.getConfig().maxHz).toBe(120);
    });
  });

  describe('updateFromRTT', () => {
    it('should increase Hz on low RTT (<30ms)', () => {
      // Feed excellent RTT values
      for (let i = 0; i < 10; i++) {
        tickRate.updateFromRTT(20, mockTime);
        mockTime += 100;
      }

      // Wait for cooldown
      mockTime += 2000;
      tickRate.updateFromRTT(20, mockTime);

      expect(tickRate.getTargetHz()).toBe(60); // Should target maxHz
    });

    it('should decrease Hz on high RTT (>100ms)', () => {
      // Feed poor RTT values
      for (let i = 0; i < 10; i++) {
        tickRate.updateFromRTT(120, mockTime);
        mockTime += 100;
      }

      // Wait for cooldown
      mockTime += 2000;
      tickRate.updateFromRTT(120, mockTime);

      expect(tickRate.getTargetHz()).toBe(25); // Should reduce frequency
    });

    it('should drop to minimum Hz on very high RTT (>150ms)', () => {
      // Feed very poor RTT values
      for (let i = 0; i < 10; i++) {
        tickRate.updateFromRTT(200, mockTime);
        mockTime += 100;
      }

      // Wait for cooldown
      mockTime += 2000;
      tickRate.updateFromRTT(200, mockTime);

      expect(tickRate.getTargetHz()).toBe(20); // Should be at minHz
    });

    it('should respect cooldown period', () => {
      // First update
      tickRate.updateFromRTT(150, mockTime);
      mockTime += 2000;
      tickRate.updateFromRTT(150, mockTime);

      const targetAfterFirst = tickRate.getTargetHz();

      // Try to update immediately (within cooldown)
      mockTime += 500;
      tickRate.updateFromRTT(20, mockTime); // Try to trigger increase

      // Target should not change yet
      expect(tickRate.getTargetHz()).toBe(targetAfterFirst);

      // After cooldown expires
      mockTime += 2000;
      tickRate.updateFromRTT(20, mockTime);

      // Now it should change
      expect(tickRate.getTargetHz()).toBeGreaterThan(targetAfterFirst);
    });

    it('should use RTT history for averaging', () => {
      // Mix of good and bad RTT
      tickRate.updateFromRTT(20, mockTime);
      mockTime += 100;
      tickRate.updateFromRTT(150, mockTime);
      mockTime += 100;
      tickRate.updateFromRTT(30, mockTime);

      const avgRtt = tickRate.getAverageRTT();
      expect(avgRtt).toBeCloseTo((20 + 150 + 30) / 3, 1);
    });

    it('should limit RTT history size', () => {
      // Add more than maxRttHistory (10) samples
      for (let i = 0; i < 20; i++) {
        tickRate.updateFromRTT(50 + i, mockTime);
        mockTime += 100;
      }

      // Average should only consider last 10
      const avgRtt = tickRate.getAverageRTT();
      const expectedAvg = (60 + 61 + 62 + 63 + 64 + 65 + 66 + 67 + 68 + 69) / 10;
      expect(avgRtt).toBeCloseTo(expectedAvg, 1);
    });
  });

  describe('update and getCurrentHz', () => {
    it('should smoothly transition to target with update()', () => {
      // Set up for increase
      for (let i = 0; i < 10; i++) {
        tickRate.updateFromRTT(20, mockTime);
        mockTime += 100;
      }
      mockTime += 2000;
      tickRate.updateFromRTT(20, mockTime);

      expect(tickRate.getTargetHz()).toBe(60);

      // Current should gradually approach target
      tickRate.update();
      const hz1 = tickRate.getCurrentHz();
      tickRate.update();
      const hz2 = tickRate.getCurrentHz();
      tickRate.update();
      const hz3 = tickRate.getCurrentHz();

      expect(hz1).toBeLessThan(60);
      expect(hz2).toBeGreaterThan(hz1);
      expect(hz3).toBeGreaterThan(hz2);
    });

    it('should snap to target when very close', () => {
      // Manually set close to target
      for (let i = 0; i < 10; i++) {
        tickRate.updateFromRTT(20, mockTime);
        mockTime += 100;
      }
      mockTime += 2000;
      tickRate.updateFromRTT(20, mockTime);

      // Call update multiple times until stable
      for (let i = 0; i < 50; i++) {
        tickRate.update();
      }

      expect(tickRate.getCurrentHz()).toBe(60);
      expect(tickRate.isStable()).toBe(true);
    });

    it('should not overshoot target', () => {
      // Set up for decrease
      for (let i = 0; i < 10; i++) {
        tickRate.updateFromRTT(200, mockTime);
        mockTime += 100;
      }
      mockTime += 2000;
      tickRate.updateFromRTT(200, mockTime);

      const target = tickRate.getTargetHz();
      let previousHz = tickRate.getCurrentHz();

      // Current should monotonically approach target (never overshoot)
      for (let i = 0; i < 100; i++) {
        tickRate.update();
        const current = tickRate.getCurrentHz();

        // Should be moving towards target
        expect(current).toBeLessThanOrEqual(previousHz + 0.1); // Allow tiny rounding

        // Once reached target, should stay there
        if (Math.abs(current - target) < 1) {
          expect(current).toBeCloseTo(target, 0);
        }

        previousHz = current;
      }

      // Should eventually reach target
      expect(tickRate.getCurrentHz()).toBeCloseTo(target, 0);
    });

    it('should support time-based smoothing with deltaTime', () => {
      // Set up for increase
      for (let i = 0; i < 10; i++) {
        tickRate.updateFromRTT(20, mockTime);
        mockTime += 100;
      }
      mockTime += 2000;
      tickRate.updateFromRTT(20, mockTime);

      expect(tickRate.getTargetHz()).toBe(60);

      // Simulate 60 FPS (16.67ms per frame)
      const deltaTime = 1 / 60;
      const hz1 = tickRate.getCurrentHz();

      // Run enough updates to see measurable change after rounding
      for (let i = 0; i < 20; i++) {
        tickRate.update(deltaTime);
      }
      const hz2 = tickRate.getCurrentHz();

      expect(hz1).toBeLessThan(60);
      expect(hz2).toBeGreaterThan(hz1);
      expect(hz2).toBeLessThanOrEqual(60);
    });

    it('should be idempotent - multiple getCurrentHz() calls return same value', () => {
      tickRate.update();
      const hz1 = tickRate.getCurrentHz();
      const hz2 = tickRate.getCurrentHz();
      const hz3 = tickRate.getCurrentHz();

      expect(hz1).toBe(hz2);
      expect(hz2).toBe(hz3);
    });
  });

  describe('getTickIntervalMs', () => {
    it('should return correct interval for current Hz', () => {
      const hz = tickRate.getCurrentHz();
      const interval = tickRate.getTickIntervalMs();

      expect(interval).toBeCloseTo(1000 / hz, 1);
    });

    it('should update as Hz changes', () => {
      const interval1 = tickRate.getTickIntervalMs();

      // Change Hz
      for (let i = 0; i < 10; i++) {
        tickRate.updateFromRTT(20, mockTime);
        mockTime += 100;
      }
      mockTime += 2000;
      tickRate.updateFromRTT(20, mockTime);

      // Let it smooth towards target
      for (let i = 0; i < 10; i++) {
        tickRate.update();
      }

      const interval2 = tickRate.getTickIntervalMs();

      expect(interval2).toBeLessThan(interval1); // Higher Hz = lower interval
    });
  });

  describe('isStable', () => {
    it('should return true when current equals target', () => {
      expect(tickRate.isStable()).toBe(true); // Starts stable
    });

    it('should return false during transition', () => {
      // Trigger change
      for (let i = 0; i < 10; i++) {
        tickRate.updateFromRTT(20, mockTime);
        mockTime += 100;
      }
      mockTime += 2000;
      tickRate.updateFromRTT(20, mockTime);

      // Should be unstable immediately after target change
      tickRate.getCurrentHz(); // Trigger one smoothing step
      expect(tickRate.isStable()).toBe(false);
    });

    it('should return true after settling', () => {
      // Trigger change
      for (let i = 0; i < 10; i++) {
        tickRate.updateFromRTT(20, mockTime);
        mockTime += 100;
      }
      mockTime += 2000;
      tickRate.updateFromRTT(20, mockTime);

      // Let it settle by calling update() to converge currentHz to targetHz
      for (let i = 0; i < 100; i++) {
        mockTime += 16; // ~60fps frame time
        tickRate.update(mockTime);
      }

      expect(tickRate.isStable()).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset to initial state', () => {
      // Make changes
      for (let i = 0; i < 10; i++) {
        tickRate.updateFromRTT(200, mockTime);
        mockTime += 100;
      }
      mockTime += 2000;
      tickRate.updateFromRTT(200, mockTime);

      tickRate.reset();

      expect(tickRate.getCurrentHz()).toBe(30);
      expect(tickRate.getTargetHz()).toBe(30);
      expect(tickRate.getAverageRTT()).toBe(0);
      expect(tickRate.isStable()).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle zero RTT', () => {
      tickRate.updateFromRTT(0, mockTime);
      expect(tickRate.getAverageRTT()).toBe(0);
    });

    it('should handle extreme RTT values', () => {
      tickRate.updateFromRTT(10000, mockTime);
      mockTime += 2000;
      tickRate.updateFromRTT(10000, mockTime);

      // Should clamp to minHz
      expect(tickRate.getTargetHz()).toBe(20);
    });

    it('should handle rapid RTT fluctuations', () => {
      // Alternate between good and bad
      for (let i = 0; i < 20; i++) {
        const rtt = i % 2 === 0 ? 20 : 200;
        tickRate.updateFromRTT(rtt, mockTime);
        mockTime += 100;
      }

      // Should average out to moderate RTT
      const avgRtt = tickRate.getAverageRTT();
      expect(avgRtt).toBeGreaterThan(50);
      expect(avgRtt).toBeLessThan(150);
    });
  });
});
