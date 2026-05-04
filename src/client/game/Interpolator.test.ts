import { describe, it, expect, beforeEach } from 'vitest';
import { Interpolator } from './Interpolator';
import type { PlayerSnapshot } from '../../shared/protocol';

describe('Interpolator', () => {
  let interpolator: Interpolator;

  beforeEach(() => {
    interpolator = new Interpolator(100); // 100ms render delay
  });

  const createSnapshot = (
    time: number,
    position: [number, number, number],
    rotation: [number, number, number, number] = [0, 0, 0, 1],
    velocity: [number, number, number] = [0, 0, 0]
  ): PlayerSnapshot => ({
    id: 'test-player',
    name: 'Test',
    carColor: 0xff0000,
    position,
    rotation,
    velocity,
    speedKmh: 100,
    gear: 3,
    currentLap: 1,
    lapTimeMs: 10000,
    lastLapMs: null,
    bestLapMs: null,
  });

  describe('addSnapshot', () => {
    it('should add snapshots in order', () => {
      interpolator.addSnapshot(createSnapshot(1000, [0, 0, 0]), 1000);
      interpolator.addSnapshot(createSnapshot(2000, [10, 0, 0]), 2000);

      expect(interpolator.getBufferSize()).toBe(2);
    });

    it('should insert out-of-order snapshots correctly', () => {
      interpolator.addSnapshot(createSnapshot(2000, [10, 0, 0]), 2000);
      interpolator.addSnapshot(createSnapshot(1000, [0, 0, 0]), 1000);
      interpolator.addSnapshot(createSnapshot(1500, [5, 0, 0]), 1500);

      expect(interpolator.getBufferSize()).toBe(3);
    });

    it('should limit buffer size', () => {
      // Add more than SNAPSHOT_BUFFER_SIZE snapshots
      for (let i = 0; i < 100; i++) {
        interpolator.addSnapshot(createSnapshot(i * 100, [i, 0, 0]), i * 100);
      }

      // Buffer should be capped
      expect(interpolator.getBufferSize()).toBeLessThanOrEqual(20);
    });
  });

  describe('interpolate', () => {
    it('should return null with no snapshots', () => {
      const result = interpolator.interpolate(1000);
      expect(result).toBeNull();
    });

    it('should return the only snapshot if only one exists', () => {
      interpolator.addSnapshot(createSnapshot(1000, [5, 0, 0]), 1000);

      const result = interpolator.interpolate(1000);
      expect(result).not.toBeNull();
      expect(result!.position.x).toBe(5);
    });

    it('should interpolate between two snapshots', () => {
      interpolator.addSnapshot(createSnapshot(1000, [0, 0, 0]), 1000);
      interpolator.addSnapshot(createSnapshot(2000, [10, 0, 0]), 2000);

      // Render time = 1600 - 100 = 1500 (midpoint between 1000 and 2000)
      const result = interpolator.interpolate(1600);
      expect(result).not.toBeNull();
      expect(result!.position.x).toBeCloseTo(5, 1); // Should be halfway
    });

    it('should extrapolate when ahead of snapshots', () => {
      interpolator.addSnapshot(createSnapshot(1000, [0, 0, 0], [0, 0, 0, 1], [10, 0, 0]), 1000);
      interpolator.addSnapshot(createSnapshot(2000, [10, 0, 0], [0, 0, 0, 1], [10, 0, 0]), 2000);

      // Render time = 2200 - 100 = 2100 (100ms ahead of last snapshot)
      const result = interpolator.interpolate(2200);
      expect(result).not.toBeNull();
      // Should extrapolate using velocity: 10 + (10 * 0.1) = 11
      expect(result!.position.x).toBeCloseTo(11, 1);
    });

    it('should not extrapolate beyond 200ms', () => {
      interpolator.addSnapshot(createSnapshot(1000, [0, 0, 0], [0, 0, 0, 1], [10, 0, 0]), 1000);
      interpolator.addSnapshot(createSnapshot(2000, [10, 0, 0], [0, 0, 0, 1], [10, 0, 0]), 2000);

      // Render time = 2400 - 100 = 2300 (300ms ahead, beyond extrapolation limit)
      const result = interpolator.interpolate(2400);
      expect(result).not.toBeNull();
      // Should just use latest snapshot
      expect(result!.position.x).toBe(10);
    });

    it('should handle render delay correctly', () => {
      const customInterpolator = new Interpolator(200); // 200ms delay
      customInterpolator.addSnapshot(createSnapshot(1000, [0, 0, 0]), 1000);
      customInterpolator.addSnapshot(createSnapshot(2000, [10, 0, 0]), 2000);

      // Current time = 1700, render time = 1700 - 200 = 1500 (midpoint)
      const result = customInterpolator.interpolate(1700);
      expect(result).not.toBeNull();
      expect(result!.position.x).toBeCloseTo(5, 1);
    });
  });

  describe('reset', () => {
    it('should clear all snapshots', () => {
      interpolator.addSnapshot(createSnapshot(1000, [0, 0, 0]), 1000);
      interpolator.addSnapshot(createSnapshot(2000, [10, 0, 0]), 2000);

      interpolator.reset();

      expect(interpolator.getBufferSize()).toBe(0);
      expect(interpolator.hasData()).toBe(false);
    });
  });

  describe('hasData', () => {
    it('should return false when empty', () => {
      expect(interpolator.hasData()).toBe(false);
    });

    it('should return true when has snapshots', () => {
      interpolator.addSnapshot(createSnapshot(1000, [0, 0, 0]), 1000);
      expect(interpolator.hasData()).toBe(true);
    });
  });
});
