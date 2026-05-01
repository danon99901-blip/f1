import * as THREE from 'three';
import { initPhysics, RAPIER } from './physics';
import { createScene, createGround } from './scene';
import { createInput } from './input';

async function main() {
  const appEl = document.getElementById('app');
  const loadingEl = document.getElementById('loading');
  if (!appEl) throw new Error('#app not found');

  const world = await initPhysics();
  const { scene, camera, renderer } = createScene(appEl);
  createGround(scene);

  const groundCollider = RAPIER.ColliderDesc.cuboid(200, 0.1, 200).setTranslation(0, -0.1, 0);
  world.createCollider(groundCollider);

  const carBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.9, 0.4, 2).setDensity(20), carBody);

  const carMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.8, 4),
    new THREE.MeshStandardMaterial({ color: 0xe10600, roughness: 0.4, metalness: 0.3 })
  );
  carMesh.castShadow = true;
  scene.add(carMesh);

  const input = createInput();

  loadingEl?.classList.add('hidden');

  const clock = new THREE.Clock();
  const tmpForward = new THREE.Vector3();
  const cameraTarget = new THREE.Vector3();
  const cameraOffset = new THREE.Vector3(0, 5, 11);

  function loop() {
    const dt = Math.min(clock.getDelta(), 1 / 30);
    world.timestep = dt;

    const yaw = carMesh.rotation.y;
    const force = 8000;
    const steerTorque = 1500;
    if (input.state.forward !== 0) {
      tmpForward.set(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(force * input.state.forward);
      carBody.addForce(tmpForward, true);
    }
    if (input.state.steer !== 0) {
      carBody.addTorque({ x: 0, y: steerTorque * input.state.steer, z: 0 }, true);
    }
    if (input.state.brake) {
      const v = carBody.linvel();
      carBody.applyImpulse({ x: -v.x * 50, y: 0, z: -v.z * 50 }, true);
    }
    const av = carBody.angvel();
    carBody.setAngvel({ x: av.x * 0.9, y: av.y * 0.92, z: av.z * 0.9 }, true);

    world.step();

    const t = carBody.translation();
    const r = carBody.rotation();
    carMesh.position.set(t.x, t.y, t.z);
    carMesh.quaternion.set(r.x, r.y, r.z, r.w);

    cameraTarget.copy(carMesh.position);
    const offsetWorld = cameraOffset.clone().applyQuaternion(carMesh.quaternion);
    camera.position.lerp(cameraTarget.clone().add(offsetWorld), 0.08);
    camera.lookAt(cameraTarget);

    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = 'ERROR — see console';
});
