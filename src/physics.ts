import RAPIER from '@dimforge/rapier3d-compat';
import { RemoteLogger } from './utils/RemoteLogger';

let initialized = false;

export async function initPhysics(): Promise<RAPIER.World> {
  if (!initialized) {
    RemoteLogger.log('info', '[Physics] Starting RAPIER.init()...');
    try {
      await RAPIER.init();
      initialized = true;
      RemoteLogger.log('info', '[Physics] RAPIER.init() complete!');
    } catch (error) {
      RemoteLogger.log('error', '[Physics] RAPIER.init() failed:', error);
      throw error;
    }
  }
  RemoteLogger.log('info', '[Physics] Creating world...');
  const gravity = { x: 0, y: -9.81, z: 0 };
  const world = new RAPIER.World(gravity);
  RemoteLogger.log('info', '[Physics] World created!');
  return world;
}

export { RAPIER };
