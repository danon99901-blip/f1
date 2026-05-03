// Physics module - Rapier physics engine
import RAPIER from '@dimforge/rapier3d-compat';

let rapierInstance: typeof RAPIER | null = null;
let initPromise: Promise<void> | null = null;

export async function initPhysics(): Promise<RAPIER.World> {
  console.log('[Physics] Initializing Rapier...');

  // Ensure RAPIER.init() is called only once
  if (!initPromise) {
    initPromise = RAPIER.init().then(() => {
      rapierInstance = RAPIER;
      console.log('[Physics] Rapier initialized successfully');
    });
  }

  await initPromise;

  const gravity = { x: 0, y: -9.81, z: 0 };
  const world = new RAPIER.World(gravity);

  return world;
}

export function getRAPIER(): typeof RAPIER {
  console.log('[Physics] getRAPIER() called, rapierInstance:', rapierInstance ? 'initialized' : 'NULL');
  if (!rapierInstance) {
    throw new Error('[Physics] RAPIER not initialized. Call initPhysics() first and await its completion.');
  }
  return rapierInstance;
}

