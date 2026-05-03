import { describe, it, expect, beforeEach } from 'vitest';
import { PerformanceMonitor } from './PerformanceMonitor';

describe('PerformanceMonitor', () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    monitor = new PerformanceMonitor();
  });

  it('should initialize with zero metrics', () => {
    const metrics = monitor.getMetrics();
    expect(metrics.fps).toBe(0);
    expect(metrics.frameTime).toBe(0);
    expect(metrics.physicsTime).toBe(0);
  });

  it('should update FPS after multiple frames', async () => {
    // Simulate frames
    for (let i = 0; i < 60; i++) {
      monitor.update();
      await new Promise(resolve => setTimeout(resolve, 16)); // ~60 FPS
    }

    const metrics = monitor.getMetrics();
    expect(metrics.fps).toBeGreaterThan(0);
    expect(metrics.fps).toBeLessThanOrEqual(65); // Allow some variance
  });

  it('should record physics time', () => {
    monitor.recordPhysicsTime(5.5);
    monitor.recordPhysicsTime(6.2);
    monitor.recordPhysicsTime(4.8);

    const metrics = monitor.getMetrics();
    expect(metrics.physicsTime).toBeGreaterThan(0);
    expect(metrics.physicsTimeMax).toBeGreaterThanOrEqual(metrics.physicsTime);
  });

  it('should track frame time samples', async () => {
    // Need to wait for FPS update interval (500ms)
    for (let i = 0; i < 35; i++) {
      monitor.update();
      await new Promise(resolve => setTimeout(resolve, 16));
    }

    const metrics = monitor.getMetrics();
    expect(metrics.frameTime).toBeGreaterThan(0);
    expect(metrics.frameTimeMax).toBeGreaterThanOrEqual(metrics.frameTime);
  });

  it('should update network stats', () => {
    monitor.updateNetworkStats(50, 5, 0.5);

    const metrics = monitor.getMetrics();
    expect(metrics.ping).toBe(50);
    expect(metrics.jitter).toBe(5);
    expect(metrics.packetLoss).toBe(0.5);
  });

  it('should handle partial network stats updates', () => {
    monitor.updateNetworkStats(100);
    let metrics = monitor.getMetrics();
    expect(metrics.ping).toBe(100);
    expect(metrics.jitter).toBeUndefined();

    monitor.updateNetworkStats(undefined, 10);
    metrics = monitor.getMetrics();
    expect(metrics.ping).toBe(100);
    expect(metrics.jitter).toBe(10);
  });

  it('should reset metrics', () => {
    monitor.update();
    monitor.recordPhysicsTime(10);
    monitor.updateNetworkStats(50, 5);

    monitor.reset();

    const metrics = monitor.getMetrics();
    expect(metrics.fps).toBe(0);
    expect(metrics.frameTime).toBe(0);
    expect(metrics.physicsTime).toBe(0);
    expect(metrics.ping).toBeUndefined();
  });

  it('should limit sample buffer size', () => {
    // Record more than maxSamples (60)
    for (let i = 0; i < 100; i++) {
      monitor.recordPhysicsTime(i);
    }

    const metrics = monitor.getMetrics();
    // Should still compute average without overflow
    expect(metrics.physicsTime).toBeGreaterThan(0);
    expect(metrics.physicsTimeMax).toBeLessThanOrEqual(99);
  });

  it('should calculate average correctly', () => {
    monitor.recordPhysicsTime(10);
    monitor.recordPhysicsTime(20);
    monitor.recordPhysicsTime(30);

    const metrics = monitor.getMetrics();
    expect(metrics.physicsTime).toBe(20); // (10 + 20 + 30) / 3
  });

  it('should track max values correctly', () => {
    monitor.recordPhysicsTime(5);
    monitor.recordPhysicsTime(15);
    monitor.recordPhysicsTime(10);

    const metrics = monitor.getMetrics();
    expect(metrics.physicsTimeMax).toBe(15);
  });
});
