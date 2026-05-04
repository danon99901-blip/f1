import { describe, it, expect, beforeEach } from 'vitest';
import { AdaptiveNetworkConfig } from './NetworkConfig';

describe('AdaptiveNetworkConfig', () => {
  let config: AdaptiveNetworkConfig;

  beforeEach(() => {
    config = new AdaptiveNetworkConfig();
  });

  describe('default configuration', () => {
    it('should start with excellent connection defaults (30Hz, 90ms buffer)', () => {
      const cfg = config.getConfig();
      expect(cfg.snapshotInterval).toBe(33);
      expect(cfg.inputSendInterval).toBe(33);
      expect(cfg.interpolationDelay).toBe(90);
    });

    it('should have zero average ping initially', () => {
      expect(config.getAveragePing()).toBe(0);
    });
  });

  describe('updateFromPing', () => {
    it('should maintain excellent config for low ping (< 50ms)', () => {
      config.updateFromPing(30);
      config.updateFromPing(40);
      config.updateFromPing(35);

      const cfg = config.getConfig();
      expect(cfg.snapshotInterval).toBe(33);
      expect(cfg.inputSendInterval).toBe(33);
      expect(cfg.interpolationDelay).toBe(90);
    });

    it('should adjust to good config for medium ping (50-100ms)', () => {
      config.updateFromPing(70);
      config.updateFromPing(80);
      config.updateFromPing(75);

      const cfg = config.getConfig();
      expect(cfg.snapshotInterval).toBe(50);
      expect(cfg.inputSendInterval).toBe(50);
      expect(cfg.interpolationDelay).toBe(130);
    });

    it('should adjust to fair config for high ping (100-150ms)', () => {
      config.updateFromPing(120);
      config.updateFromPing(130);
      config.updateFromPing(125);

      const cfg = config.getConfig();
      expect(cfg.snapshotInterval).toBe(66);
      expect(cfg.inputSendInterval).toBe(66);
      expect(cfg.interpolationDelay).toBe(170);
    });

    it('should adjust to poor config for very high ping (> 150ms)', () => {
      config.updateFromPing(180);
      config.updateFromPing(200);
      config.updateFromPing(190);

      const cfg = config.getConfig();
      expect(cfg.snapshotInterval).toBe(100);
      expect(cfg.inputSendInterval).toBe(100);
      expect(cfg.interpolationDelay).toBe(230);
    });

    it('should calculate average ping correctly', () => {
      config.updateFromPing(50);
      config.updateFromPing(60);
      config.updateFromPing(70);

      expect(config.getAveragePing()).toBe(60);
    });

    it('should limit ping history size', () => {
      // Add more than maxPingHistory (10) values
      for (let i = 0; i < 15; i++) {
        config.updateFromPing(100 + i);
      }

      // Average should only consider last 10 values (105-114)
      const avgPing = config.getAveragePing();
      expect(avgPing).toBeCloseTo(109.5, 1);
    });

    it('should adapt to improving connection', () => {
      // Start with poor connection
      config.updateFromPing(200);
      config.updateFromPing(190);
      config.updateFromPing(180);

      let cfg = config.getConfig();
      expect(cfg.snapshotInterval).toBe(100);

      // Connection improves
      for (let i = 0; i < 10; i++) {
        config.updateFromPing(40);
      }

      cfg = config.getConfig();
      expect(cfg.snapshotInterval).toBe(33);
      expect(cfg.interpolationDelay).toBe(90);
    });

    it('should adapt to degrading connection', () => {
      // Start with good connection
      config.updateFromPing(40);
      config.updateFromPing(45);
      config.updateFromPing(35);

      let cfg = config.getConfig();
      expect(cfg.snapshotInterval).toBe(33);

      // Connection degrades
      for (let i = 0; i < 10; i++) {
        config.updateFromPing(180);
      }

      cfg = config.getConfig();
      expect(cfg.snapshotInterval).toBe(100);
      expect(cfg.interpolationDelay).toBe(230);
    });
  });

  describe('getters', () => {
    it('should return correct snapshot interval', () => {
      config.updateFromPing(120);
      expect(config.getSnapshotInterval()).toBe(66);
    });

    it('should return correct input send interval', () => {
      config.updateFromPing(120);
      expect(config.getInputSendInterval()).toBe(66);
    });

    it('should return correct interpolation delay', () => {
      config.updateFromPing(120);
      expect(config.getInterpolationDelay()).toBe(170);
    });
  });

  describe('reset', () => {
    it('should reset to default configuration', () => {
      config.updateFromPing(200);
      config.updateFromPing(190);
      config.updateFromPing(180);

      config.reset();

      const cfg = config.getConfig();
      expect(cfg.snapshotInterval).toBe(33);
      expect(cfg.inputSendInterval).toBe(33);
      expect(cfg.interpolationDelay).toBe(90);
      expect(config.getAveragePing()).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle ping at exact threshold boundaries', () => {
      config.updateFromPing(50);
      let cfg = config.getConfig();
      expect(cfg.snapshotInterval).toBe(50); // Should be in 50-100 range

      config.reset();
      config.updateFromPing(100);
      cfg = config.getConfig();
      expect(cfg.snapshotInterval).toBe(66); // Should be in 100-150 range

      config.reset();
      config.updateFromPing(150);
      cfg = config.getConfig();
      expect(cfg.snapshotInterval).toBe(100); // Should be in > 150 range
    });

    it('should handle zero ping', () => {
      config.updateFromPing(0);
      const cfg = config.getConfig();
      expect(cfg.snapshotInterval).toBe(33);
    });

    it('should handle extremely high ping', () => {
      config.updateFromPing(1000);
      const cfg = config.getConfig();
      expect(cfg.snapshotInterval).toBe(100);
      expect(cfg.interpolationDelay).toBe(230);
    });

    it('should hold invariant: interpolationDelay >= 2 * snapshotInterval', () => {
      // This invariant prevents extrapolation under normal jitter, which is the
      // root cause of remote-car stutter.
      const samples = [10, 30, 49, 70, 99, 120, 149, 200, 500];
      for (const ping of samples) {
        config.reset();
        config.updateFromPing(ping);
        const cfg = config.getConfig();
        expect(cfg.interpolationDelay).toBeGreaterThanOrEqual(2 * cfg.snapshotInterval);
      }
    });
  });
});
