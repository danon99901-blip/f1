# F1 Racing

Browser-based 3D F1 racing game. Three.js + Rapier (physics) + TypeScript + Vite.

## Run

```
npm install
npm run dev
```

Controls: **W/S** throttle/reverse, **A/D** steer, **Space** brake.

## Layout

```
src/
  main.ts             game loop, camera, respawn, wires modules together
  scene.ts            Three.js scene, camera, lights, ground
  physics.ts          Rapier world init
  input.ts            keyboard state (KeyboardEvent.code)
  car/vehicle.ts      raycast vehicle controller, aero, tyre temp/wear
  track/circuit.ts    control points + Catmull-Rom centerline
  track/track.ts      ribbon mesh, kerbs, barriers, trimesh collider, checkpoints
  track/lap.ts        lap state machine (anti-shortcut, anti-reverse)
  hud/hud.ts          broadcast-style HUD (speed, gear, lap times, position)
  hud/styles.css      HUD styling
  effects/composer.ts SMAA + bloom + speed-reactive aberration/vignette + grain
  ai/opponents.ts     kinematic opponents on the centerline, destructible debris
```
