import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { initPhysics } from '../physics';
import { createTrack } from './track';

describe('track', () => {
  let world: RAPIER.World;
  let scene: THREE.Scene;

  beforeEach(async () => {
    world = await initPhysics();
    scene = new THREE.Scene();
  });

  afterEach(() => {
    if (world) {
      world.free();
    }
  });

  it('should create default track', () => {
    const track = createTrack(world, scene, 'default');
    expect(track.mesh).toBeDefined();
    expect(track.collider).toBeDefined();
    expect(track.checkpoints.length).toBeGreaterThan(0);
    expect(track.lapInfo.length).toBeGreaterThan(0);
    track.dispose();
  });

  it('should create Silverstone track', () => {
    const track = createTrack(world, scene, 'silverstone');
    expect(track.mesh).toBeDefined();
    expect(track.collider).toBeDefined();
    expect(track.checkpoints.length).toBeGreaterThan(0);
    expect(track.lapInfo.length).toBeGreaterThan(0);
    track.dispose();
  });

  it('should create Monaco track', () => {
    const track = createTrack(world, scene, 'monaco');
    expect(track.mesh).toBeDefined();
    expect(track.collider).toBeDefined();
    expect(track.checkpoints.length).toBeGreaterThan(0);
    expect(track.lapInfo.length).toBeGreaterThan(0);
    track.dispose();
  });

  it('should have different lap lengths for different tracks', () => {
    const defaultTrack = createTrack(world, scene, 'default');
    const silverstoneTrack = createTrack(world, scene, 'silverstone');
    const monacoTrack = createTrack(world, scene, 'monaco');

    expect(defaultTrack.lapInfo.length).not.toBe(silverstoneTrack.lapInfo.length);
    expect(defaultTrack.lapInfo.length).not.toBe(monacoTrack.lapInfo.length);
    expect(silverstoneTrack.lapInfo.length).not.toBe(monacoTrack.lapInfo.length);

    defaultTrack.dispose();
    silverstoneTrack.dispose();
    monacoTrack.dispose();
  });

  it('should default to default track when no type specified', () => {
    const track = createTrack(world, scene);
    expect(track.mesh).toBeDefined();
    expect(track.lapInfo.length).toBeGreaterThan(0);
    track.dispose();
  });
});
