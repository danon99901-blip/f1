# Rapier Memory Leak Fix

## Problem
Rapier physics objects (World, RigidBody, Collider) were not being properly cleaned up, causing WebAssembly memory leaks when transitioning between game states.

## Root Cause
- `world.free()` was called in `PhysicsService.dispose()` ✓
- However, individual physics objects (vehicles, track colliders, opponent bodies) were removed from the world but not properly disposed
- Rapier's high-level API manages memory through the World, but requires explicit removal via `world.removeRigidBody()` and `world.removeCollider()`

## Changes Made

### 1. Vehicle (`src/car/vehicle.ts`)
- Added `dispose()` method to `Vehicle` interface
- Implemented `dispose()` in `createVehicle()` (currently a no-op, as memory is managed by World)
- Note: Rapier's high-level API doesn't expose `.free()` on RigidBody/Collider - memory is released when removed from World

### 2. Track (`src/track/track.ts`)
- Added `dispose()` method to `Track` interface
- Implemented cleanup for:
  - Main track trimesh collider
  - All checkpoint sensor colliders (CHECKPOINT_COUNT colliders)
  - All barrier colliders (created in `buildBarriers()`)
- Calls `world.removeCollider()` for each collider before World cleanup

### 3. Opponents (`src/ai/opponents.ts`)
- Updated `destroyOpponent()` to properly remove collider and rigid body from world
- Updated `dispose()` to ensure all opponent physics objects are removed
- Already had proper Three.js geometry/material cleanup ✓

### 4. PhysicsService (`src/services/PhysicsService.ts`)
- Updated `destroyVehicle()` to call `vehicle.dispose()` before removing from world
- Updated `dispose()` to call `vehicle.dispose()` on all vehicles before world cleanup
- Ensures proper cleanup order: vehicle resources → remove from world → free world

### 5. RacingState (`src/states/RacingState.ts`)
- Added `track` field to store track reference
- Added `track.dispose()` call in `exit()` method before cleaning up Three.js meshes
- Ensures all track colliders are removed before PhysicsService cleanup

## Memory Management in Rapier

Rapier uses a two-tier memory model:

1. **Low-level (Raw) API**: `RawWorld`, `RawRigidBodySet`, `RawColliderSet` have `.free()` methods
2. **High-level API**: `World`, `RigidBody`, `Collider` manage memory automatically

**Key points:**
- Individual `RigidBody` and `Collider` objects don't have `.free()` methods
- Memory is released when:
  - `world.removeRigidBody(body)` is called
  - `world.removeCollider(collider)` is called
  - `world.free()` is called (releases all remaining objects)
- Proper cleanup order: remove objects from world → free world

## Cleanup Order

```
RacingState.exit()
  ├─ track.dispose()
  │   ├─ world.removeCollider(track collider)
  │   ├─ world.removeCollider(checkpoint colliders)
  │   └─ world.removeCollider(barrier colliders)
  ├─ opponentController.dispose()
  │   ├─ world.removeCollider(opponent colliders)
  │   └─ world.removeRigidBody(opponent bodies)
  └─ physicsService.destroyVehicle()
      ├─ vehicle.dispose()
      └─ world.removeRigidBody(vehicle body)

PhysicsService.dispose()
  └─ world.free() // Releases all remaining WebAssembly memory
```

## Testing
- Build passes: `npm run build` ✓
- All TypeScript errors resolved ✓
- Memory should now be properly released when exiting racing state

## Next Steps
- Monitor memory usage in browser DevTools (Performance → Memory)
- Test multiple race → menu → race cycles
- Verify WebAssembly heap doesn't grow unbounded
