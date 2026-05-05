import { describe, it, expect } from 'vitest';
import { createCenterline, createSilverstoneCircuit, createMonacoCircuit } from './circuit';

describe('circuit', () => {
  it('should create default centerline with correct number of control points', () => {
    const curve = createCenterline();
    expect(curve.points.length).toBe(16);
    expect(curve.closed).toBe(true);
  });

  it('should create Silverstone circuit with different control points', () => {
    const curve = createSilverstoneCircuit();
    expect(curve.points.length).toBe(18);
    expect(curve.closed).toBe(true);
    // Verify it's different from default track
    const defaultCurve = createCenterline();
    expect(curve.points[0]?.x).not.toBe(defaultCurve.points[0]?.x);
  });

  it('should have all control points on Y=0 plane', () => {
    const curve = createCenterline();
    curve.points.forEach((point) => {
      expect(point.y).toBe(0);
    });
  });

  it('should have Silverstone control points on Y=0 plane', () => {
    const curve = createSilverstoneCircuit();
    curve.points.forEach((point) => {
      expect(point.y).toBe(0);
    });
  });

  it('should create Monaco circuit with correct number of control points', () => {
    const curve = createMonacoCircuit();
    expect(curve.points.length).toBe(19);
    expect(curve.closed).toBe(true);
  });

  it('should have Monaco control points on Y=0 plane', () => {
    const curve = createMonacoCircuit();
    curve.points.forEach((point) => {
      expect(point.y).toBe(0);
    });
  });

  it('should create three distinct circuits', () => {
    const defaultCurve = createCenterline();
    const silverstone = createSilverstoneCircuit();
    const monaco = createMonacoCircuit();

    // Verify all three are different
    expect(defaultCurve.points[0]?.x).not.toBe(silverstone.points[0]?.x);
    expect(defaultCurve.points[0]?.x).not.toBe(monaco.points[0]?.x);
    expect(silverstone.points[0]?.x).not.toBe(monaco.points[0]?.x);
  });
});
