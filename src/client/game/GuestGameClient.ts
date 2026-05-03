// Guest game client - receives snapshots from host and interpolates

import * as THREE from 'three';
import { createScene, createGround } from '../../scene';
import { createCarModel } from '../../car/vehicle';
import { createHud } from '../../hud/hud';
import { createComposer } from '../../effects/composer';
import { Interpolator } from './Interpolator';
import { CountdownOverlay } from './CountdownOverlay';
import { PlayerNameTag } from './PlayerNameTag';
import type { NetworkClient } from '../network/NetworkClient';
import type { HostMessage, PlayerSnapshot } from '../../shared/protocol';
import type { InputState } from '../../shared/types';
import '../../hud/styles.css';

interface RemotePlayerVisual {
  id: string;
  name: string;
  mesh: THREE.Group;
  interpolator: Interpolator;
  nameTag: PlayerNameTag;
}

export async function startGuestGame(
  networkClient: NetworkClient,
  localPlayerId: string,
  totalLaps: number,
) {
  const appEl = document.getElementById('app');
  const loadingEl = document.getElementById('loading');
  if (!appEl) throw new Error('#app not found');

  loadingEl?.classList.remove('hidden');

  const hud = createHud();
  document.body.appendChild(hud.root);

  const { scene, camera, renderer } = createScene(appEl);
  const composer = createComposer(renderer, scene, camera);
  createGround(scene);

  // Create visual meshes for all players
  const playerVisuals = new Map<string, RemotePlayerVisual>();
  const colors = [0xe10600, 0x0066ff, 0xff9f1a, 0x7c4dff];
  let colorIndex = 0;

  // Input handling
  const localInput: InputState = { throttle: 0, brake: 0, steer: 0 };
  const codes = new Set<string>();
  let inputSeq = 0;

  const updateInput = () => {
    localInput.throttle = codes.has('KeyW') ? 1 : 0;
    localInput.brake = codes.has('KeyS') || codes.has('Space') ? 1 : 0;
    localInput.steer = (codes.has('KeyA') ? 1 : 0) - (codes.has('KeyD') ? 1 : 0);
  };

  const onDown = (e: KeyboardEvent) => {
    codes.add(e.code);
    updateInput();
    sendInput();
  };
  const onUp = (e: KeyboardEvent) => {
    codes.delete(e.code);
    updateInput();
    sendInput();
  };

  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);

  // Cleanup function
  const cleanup = () => {
    window.removeEventListener('keydown', onDown);
    window.removeEventListener('keyup', onUp);
    playerVisuals.forEach((visual) => {
      visual.nameTag.dispose();
      visual.interpolator.reset();
    });
  };

  window.addEventListener('beforeunload', cleanup);

  // Send input to host at 60 Hz
  setInterval(() => {
    sendInput();
  }, 1000 / 60);

  function sendInput() {
    networkClient.sendToHost({
      type: 'input',
      seq: inputSeq++,
      throttle: localInput.throttle,
      brake: localInput.brake,
      steer: localInput.steer,
      timestamp: performance.now(),
    });
  }

  // Receive snapshots from host
  let latestSnapshot: PlayerSnapshot[] = [];
  let localPlayerData: PlayerSnapshot | null = null;

  networkClient['callbacks'].onHostMessage = (message: HostMessage) => {
    if (message.type === 'snapshot') {
      latestSnapshot = message.players;

      // Create visuals for new players
      message.players.forEach((playerSnap) => {
        if (!playerVisuals.has(playerSnap.id)) {
          const mesh = createCarModel(colors[colorIndex % colors.length]!);
          scene.add(mesh);

          const nameTag = new PlayerNameTag(
            playerSnap.name,
            playerSnap.id === localPlayerId ? '#00ff00' : '#ffffff',
          );
          nameTag.addToScene(scene);

          colorIndex++;

          playerVisuals.set(playerSnap.id, {
            id: playerSnap.id,
            name: playerSnap.name,
            mesh,
            interpolator: new Interpolator(100),
            nameTag,
          });
        }

        // Add snapshot to interpolator
        const visual = playerVisuals.get(playerSnap.id);
        if (visual) {
          visual.interpolator.addSnapshot(playerSnap, message.timestamp);
        }

        // Track local player data for HUD
        if (playerSnap.id === localPlayerId) {
          localPlayerData = playerSnap;
        }
      });
    }
  };

  loadingEl?.classList.add('hidden');

  // Show countdown before starting
  const countdown = new CountdownOverlay();
  countdown.show(3, () => {
    startGameLoop();
  });

  function startGameLoop() {
    const clock = new THREE.Clock();
    const cameraTarget = new THREE.Vector3();
    const cameraOffset = new THREE.Vector3(0, 4, 10);
    let localPlayerMesh: THREE.Group | null = null;

    function loop() {
    const dt = clock.getDelta();
    const currentTime = performance.now();

    // Interpolate all players
    playerVisuals.forEach((visual) => {
      const interpolated = visual.interpolator.interpolate(currentTime);
      if (interpolated) {
        visual.mesh.position.copy(interpolated.position);
        visual.mesh.quaternion.copy(interpolated.rotation);
        visual.nameTag.updatePosition(interpolated.position);

        // Track local player mesh for camera
        if (visual.id === localPlayerId) {
          localPlayerMesh = visual.mesh;
        }
      }
    });

    // Camera follows local player
    if (localPlayerMesh) {
      cameraTarget.copy(localPlayerMesh.position);
      const offsetWorld = cameraOffset.clone().applyQuaternion(localPlayerMesh.quaternion);
      camera.position.lerp(cameraTarget.clone().add(offsetWorld), 0.08);
      camera.lookAt(cameraTarget);
    }

    // Update HUD with local player data
    if (localPlayerData) {
      const totalCars = latestSnapshot.length;
      const sortedByDistance = [...latestSnapshot].sort((a, b) => {
        // Simple position calculation based on lap and lap time
        const aProgress = a.currentLap * 1000 - a.lapTimeMs;
        const bProgress = b.currentLap * 1000 - b.lapTimeMs;
        return bProgress - aProgress;
      });
      const position = sortedByDistance.findIndex((p) => p.id === localPlayerId) + 1;

      hud.update({
        speedKmh: localPlayerData.speedKmh,
        gear: localPlayerData.gear,
        currentLap: Math.max(1, Math.min(totalLaps, localPlayerData.currentLap)),
        totalLaps,
        lapTimeMs: localPlayerData.lapTimeMs,
        lastLapMs: localPlayerData.lastLapMs,
        bestLapMs: localPlayerData.bestLapMs,
        position: Math.max(1, Math.min(totalCars, position)),
        totalCars,
      });

      composer.setSpeed(localPlayerData.speedKmh);
    }

    composer.render(dt);
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
  }
}
