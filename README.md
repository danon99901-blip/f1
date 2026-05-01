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
  main.ts       composes everything, runs the loop
  scene.ts      Three.js scene, camera, lights, ground
  physics.ts    Rapier world init
  input.ts      keyboard state
```

Phase 3 will add: `src/car/` (vehicle controller), `src/track/` (spline track), `src/hud/` (UI overlay), `src/effects/` (postprocessing).
