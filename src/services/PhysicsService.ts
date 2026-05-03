// Physics service wrapping Rapier world

import type RAPIER from '@dimforge/rapier3d-compat';
import { initPhysics, getRAPIER } from '../physics';
import type { Vehicle } from '../car/vehicle';
import { createVehicle } from '../car/vehicle';
import type { Service } from '../core/ServiceContainer';

export class PhysicsService implements Service {
  private world: RAPIER.World | null = null;
  private vehicles = new Map<string, Vehicle>();

  async init(): Promise<void> {
    this.world = await initPhysics();

    // Create ground collider
    const RAPIER_NS = getRAPIER();
    const groundCollider = RAPIER_NS.ColliderDesc.cuboid(400, 0.1, 400).setTranslation(
      0,
      -0.35,
      0
    );
    this.world!.createCollider(groundCollider);
  }

  step(dt: number): void {
    if (!this.world) {
      throw new Error('PhysicsService not initialized');
    }

    this.world.timestep = dt;
    this.world.step();

    // Sync vehicle visuals
    this.vehicles.forEach((vehicle) => {
      vehicle.syncVisuals();
    });
  }

  createVehicle(id: string, scene: any): Vehicle {
    if (!this.world) {
      throw new Error('PhysicsService not initialized');
    }

    if (this.vehicles.has(id)) {
      throw new Error(`Vehicle ${id} already exists`);
    }

    const vehicle = createVehicle(this.world, scene);
    this.vehicles.set(id, vehicle);
    return vehicle;
  }

  getVehicle(id: string): Vehicle | undefined {
    return this.vehicles.get(id);
  }

  destroyVehicle(id: string): void {
    const vehicle = this.vehicles.get(id);
    if (vehicle) {
      // Remove from physics world
      if (this.world) {
        this.world.removeRigidBody(vehicle.rigidBody);
      }
      this.vehicles.delete(id);
    }
  }

  getWorld(): RAPIER.World {
    if (!this.world) {
      throw new Error('PhysicsService not initialized');
    }
    return this.world;
  }

  reset(): void {
    this.vehicles.forEach((vehicle) => {
      vehicle.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      vehicle.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    });
  }

  dispose(): void {
    // Properly clean up all vehicles and their physics bodies
    this.vehicles.forEach((vehicle) => {
      if (this.world) {
        // Remove rigid body (this also removes attached colliders)
        this.world.removeRigidBody(vehicle.rigidBody);
      }
    });
    this.vehicles.clear();

    // Free the Rapier world to release WebAssembly memory
    if (this.world) {
      this.world.free();
    }
    this.world = null;
  }
}
