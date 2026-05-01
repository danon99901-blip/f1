import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  VignetteEffect,
} from 'postprocessing';

export interface ComposerBundle {
  composer: EffectComposer;
  render: (deltaTime?: number) => void;
  setSpeed: (kmh: number) => void;
  resize: (width: number, height: number) => void;
  dispose: () => void;
}

/**
 * Builds the postprocessing chain used by the racing game.
 *
 * Chain (multiple fullscreen EffectPass blocks on top of a RenderPass):
 *   1. SMAA           — anti-aliasing (we disable WebGL MSAA in the composer)
 *   2. Bloom          — soft glow on highlights / emissives
 *   3. Chromatic Aberr — RGB split that scales with speed
 *   4. Vignette       — corner darkening that intensifies with speed
 *   5. Noise          — subtle film grain (overlay blend)
 *
 * We intentionally split the effects into multiple passes because both Bloom
 * and ChromaticAberration are convolution effects and cannot be merged into a
 * single EffectPass by the postprocessing runtime.
 *
 * Speed-dependent ramping is driven by `setSpeed(kmh)`; we treat 300 km/h as
 * the reference top speed and lerp aberration / vignette darkness linearly
 * (clamped) toward their max values.
 *
 * NOTE: Motion blur is intentionally omitted. pmndrs/postprocessing does not
 * ship a built-in motion blur effect — implementing one requires a separate
 * velocity-buffer pass (per-object previous-frame matrices + custom shader),
 * which is out of scope for this worktree. Re-evaluate once the car/track
 * worktrees stabilise; a follow-up worktree can layer it on top.
 */
export function createComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera
): ComposerBundle {
  // multisampling: 0 — SMAA handles AA; renderer.toneMapping (ACES, set in
  // scene.ts) is respected by the composer's output pass.
  const composer = new EffectComposer(renderer, {
    multisampling: 0,
    frameBufferType: THREE.HalfFloatType,
  });

  composer.addPass(new RenderPass(scene, camera));

  // 1. SMAA — MEDIUM is a good default; HIGH bumps quality with ~negligible cost.
  const smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });

  // 2. Bloom — soft glow on bright pixels (sun reflections, emissives).
  const bloom = new BloomEffect({
    intensity: 0.6,
    luminanceThreshold: 0.85,
    luminanceSmoothing: 0.3,
    mipmapBlur: true,
    radius: 0.7,
  });

  // 3. Chromatic aberration — base offset; scaled in setSpeed().
  const baseAberration = new THREE.Vector2(0.0005, 0.0005);
  const chromaticAberration = new ChromaticAberrationEffect({
    offset: baseAberration.clone(),
    radialModulation: false,
    modulationOffset: 0.15,
  });

  // 4. Vignette — base values; darkness ramps with speed.
  const vignette = new VignetteEffect({
    offset: 0.3,
    darkness: 0.4,
  });

  // 5. Noise / film grain — very subtle, overlay blend, premultiplied.
  const noise = new NoiseEffect({
    blendFunction: BlendFunction.OVERLAY,
    premultiply: true,
  });
  noise.blendMode.opacity.value = 0.04;

  const smaaPass = new EffectPass(camera, smaa);
  const bloomPass = new EffectPass(camera, bloom);
  const stylizePass = new EffectPass(camera, chromaticAberration, vignette, noise);
  composer.addPass(smaaPass);
  composer.addPass(bloomPass);
  composer.addPass(stylizePass);

  // Speed ramping ---------------------------------------------------------
  const TOP_SPEED_KMH = 300;
  const ABERRATION_MAX_MULT = 5; // 5x base at top speed
  const VIGNETTE_BASE_DARKNESS = 0.4;
  const VIGNETTE_MAX_DARKNESS = 0.6; // subtle tunnel-vision

  function setSpeed(kmh: number) {
    const t = Math.min(Math.max(kmh / TOP_SPEED_KMH, 0), 1);

    // chromatic aberration: lerp base * 1 -> base * MAX_MULT
    const mult = 1 + (ABERRATION_MAX_MULT - 1) * t;
    chromaticAberration.offset.set(baseAberration.x * mult, baseAberration.y * mult);

    // vignette darkness ramp
    vignette.darkness = VIGNETTE_BASE_DARKNESS + (VIGNETTE_MAX_DARKNESS - VIGNETTE_BASE_DARKNESS) * t;
  }

  // Resize / cleanup ------------------------------------------------------
  function resize(width: number, height: number) {
    composer.setSize(width, height);
  }

  const onResize = () => resize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', onResize);
  // initial sync (covers HiDPI / pixelRatio differences)
  resize(window.innerWidth, window.innerHeight);

  function render(deltaTime?: number) {
    composer.render(deltaTime);
  }

  function dispose() {
    window.removeEventListener('resize', onResize);
    composer.dispose();
  }

  return { composer, render, setSpeed, resize, dispose };
}
