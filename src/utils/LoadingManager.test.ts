import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LoadingManager } from './LoadingManager';

describe('LoadingManager', () => {
  let manager: LoadingManager;

  beforeEach(() => {
    manager = new LoadingManager();
  });

  it('should initialize with 0% progress', () => {
    expect(manager.getOverallProgress()).toBe(0);
  });

  it('should update stage progress', () => {
    manager.updateStage('three', 0.5);
    expect(manager.getOverallProgress()).toBeGreaterThan(0);
    expect(manager.getOverallProgress()).toBeLessThan(100);
  });

  it('should complete stage to 100%', () => {
    manager.completeStage('three');
    const progressAfterOne = manager.getOverallProgress();
    expect(progressAfterOne).toBeGreaterThan(0);
    expect(progressAfterOne).toBeLessThan(100);
  });

  it('should reach 100% when all stages complete', () => {
    manager.completeStage('three');
    manager.completeStage('rapier');
    manager.completeStage('postprocessing');
    manager.completeStage('game-init');
    manager.completeStage('states');
    manager.completeStage('assets');

    expect(manager.getOverallProgress()).toBe(100);
  });

  it('should return current active stage', () => {
    expect(manager.getCurrentStage()).toBe('three');

    manager.completeStage('three');
    expect(manager.getCurrentStage()).toBe('rapier');

    manager.completeStage('rapier');
    manager.completeStage('postprocessing');
    expect(manager.getCurrentStage()).toBe('game-init');
  });

  it('should return "complete" when all stages done', () => {
    manager.completeStage('three');
    manager.completeStage('rapier');
    manager.completeStage('postprocessing');
    manager.completeStage('game-init');
    manager.completeStage('states');
    manager.completeStage('assets');

    expect(manager.getCurrentStage()).toBe('complete');
  });

  it('should clamp progress values to 0-1 range', () => {
    manager.updateStage('three', -0.5);
    expect(manager.getOverallProgress()).toBe(0);

    manager.updateStage('three', 1.5);
    const progress = manager.getOverallProgress();
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThanOrEqual(100);
  });

  it('should trigger onProgress callback', () => {
    const callback = vi.fn();
    manager.onProgress(callback);

    manager.updateStage('three', 0.5);
    expect(callback).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(String)
    );

    manager.completeStage('rapier');
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('should reset all stages', () => {
    manager.completeStage('three');
    manager.completeStage('rapier');
    expect(manager.getOverallProgress()).toBeGreaterThan(0);

    manager.reset();
    expect(manager.getOverallProgress()).toBe(0);
    expect(manager.getCurrentStage()).toBe('three');
  });

  it('should handle unknown stage gracefully', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    manager.updateStage('unknown-stage', 0.5);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown stage')
    );

    consoleSpy.mockRestore();
  });

  it('should calculate weighted progress correctly', () => {
    // Rapier has highest weight (40), so completing it should give ~40% progress
    manager.completeStage('rapier');
    const progress = manager.getOverallProgress();
    expect(progress).toBeGreaterThanOrEqual(35);
    expect(progress).toBeLessThanOrEqual(45);
  });
});
