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

  createVehicle(id: string, scene: any, color?: number): Vehicle {
    if (!this.world) {
      throw new Error('PhysicsService not initialized');
    }

    if (this.vehicles.has(id)) {
      console.error(`[PhysicsService] Vehicle ${id} already exists. Current vehicles:`, Array.from(this.vehicles.keys()));
      throw new Error(`Vehicle ${id} already exists. This usually means RacingState.enter() was called multiple times without proper cleanup.`);
    }

    const vehicle = createVehicle(this.world, scene, color);
    this.vehicles.set(id, vehicle);
    console.log(`[PhysicsService] Created vehicle ${id}. Total vehicles: ${this.vehicles.size}`);
    return vehicle;
  }

  getVehicle(id: string): Vehicle | undefined {
    return this.vehicles.get(id);
  }

  destroyVehicle(id: string): void {
    const vehicle = this.vehicles.get(id);
    if (vehicle) {
      console.log(`[PhysicsService] Destroying vehicle ${id}`);
      // Dispose vehicle resources first
      if (vehicle.dispose) {
        vehicle.dispose();
      }
      // Remove from physics world
      if (this.world) {
        this.world.removeRigidBody(vehicle.rigidBody);
      }
      this.vehicles.delete(id);
      console.log(`[PhysicsService] Vehicle ${id} destroyed. Remaining vehicles: ${this.vehicles.size}`);
    } else {
      console.warn(`[PhysicsService] Attempted to destroy non-existent vehicle ${id}`);
    }
  }

  clearAllVehicles(): void {
    console.log(`[PhysicsService] Clearing all vehicles (${this.vehicles.size} total)`);
    const vehicleIds = Array.from(this.vehicles.keys());
    vehicleIds.forEach(id => {
      this.destroyVehicle(id);
    });
    console.log('[PhysicsService] All vehicles cleared');
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
      // Dispose vehicle resources first
      if (vehicle.dispose) {
        vehicle.dispose();
      }
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
