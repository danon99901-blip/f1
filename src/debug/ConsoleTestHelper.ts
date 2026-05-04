// Console helper for manual multiplayer testing
// This adds a global function to check multiplayer state from browser console

import * as THREE from 'three';

export function installConsoleTestHelper(
  gameMode: 'single' | 'multi_host' | 'multi_guest',
  scene: THREE.Scene,
  opponentController: any,
  guestVehicles?: Map<string, any>
): void {
  (window as any).checkMultiplayer = () => {
    console.log('%c=== MULTIPLAYER STATE CHECK ===', 'background: #ffff00; color: #000; font-weight: bold; padding: 10px; font-size: 16px;');

    console.log(`%cGame Mode: ${gameMode}`, 'font-weight: bold; font-size: 14px;');

    // Check scene objects
    const carMeshes: any[] = [];
    scene.traverse((obj) => {
      if (obj.name && (obj.name.includes('car') || obj.name.includes('vehicle') || obj.name.includes('chassis'))) {
        carMeshes.push({
          name: obj.name,
          type: obj.type,
          position: { x: obj.position.x.toFixed(2), y: obj.position.y.toFixed(2), z: obj.position.z.toFixed(2) },
          visible: obj.visible,
          parent: obj.parent?.name || 'scene'
        });
      }
    });

    console.log(`%cScene has ${scene.children.length} total children`, 'font-weight: bold;');
    console.log(`%cFound ${carMeshes.length} car-related meshes:`, 'font-weight: bold; color: #00ff00;');
    carMeshes.forEach((mesh, i) => {
      console.log(`  ${i + 1}. ${mesh.name} (${mesh.type}) at [${mesh.position.x}, ${mesh.position.y}, ${mesh.position.z}] visible=${mesh.visible}`);
    });

    if (gameMode === 'multi_host' && guestVehicles) {
      console.log(`%c[HOST] Guest vehicles: ${guestVehicles.size}`, 'background: #ff0000; color: #fff; font-weight: bold; padding: 5px;');
      guestVehicles.forEach((guest, id) => {
        console.log(`  - Guest ${id}:`, {
          hasVehicle: !!guest.vehicle,
          hasController: !!guest.controller,
          lastInput: guest.lastInput
        });
      });
    }

    if (gameMode === 'multi_guest' && opponentController) {
      const remoteOpponents = (opponentController as any).remoteOpponents;
      console.log(`%c[GUEST] Remote opponents: ${remoteOpponents?.size || 0}`, 'background: #00ff00; color: #000; font-weight: bold; padding: 5px;');
      if (remoteOpponents) {
        remoteOpponents.forEach((opponent: any, id: string) => {
          console.log(`  - Opponent ${id}:`, {
            name: opponent.name,
            hasMesh: !!opponent.mesh,
            meshPosition: opponent.mesh ? {
              x: opponent.mesh.position.x.toFixed(2),
              y: opponent.mesh.position.y.toFixed(2),
              z: opponent.mesh.position.z.toFixed(2)
            } : null,
            meshVisible: opponent.mesh?.visible,
            hasInterpolator: !!opponent.interpolator,
            hasNameTag: !!opponent.nameTag
          });
        });
      }
    }

    console.log('%c=== END CHECK ===', 'background: #ffff00; color: #000; font-weight: bold; padding: 10px;');
    console.log('💡 Tip: Run this command again to see updated state');
  };

  console.log('%c✅ Console test helper installed!', 'background: #00ff00; color: #000; font-weight: bold; padding: 5px;');
  console.log('%c💡 Type checkMultiplayer() in console to check multiplayer state', 'background: #0099ff; color: #fff; padding: 5px;');
}
