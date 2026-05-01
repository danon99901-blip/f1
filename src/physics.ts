import RAPIER from '@dimforge/rapier3d-compat';

let initialized = false;

export async function initPhysics(): Promise<RAPIER.World> {
  if (!initialized) {
    await RAPIER.init();
    initialized = true;
  }
  const gravity = { x: 0, y: -9.81, z: 0 };
  return new RAPIER.World(gravity);
}

export { RAPIER };
