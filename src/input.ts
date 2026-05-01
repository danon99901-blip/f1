export interface InputState {
  forward: number;
  brake: number;
  steer: number;
}

export function createInput(): { state: InputState; dispose: () => void } {
  const state: InputState = { forward: 0, brake: 0, steer: 0 };
  const codes = new Set<string>();

  const update = () => {
    state.forward = (codes.has('KeyW') ? 1 : 0) - (codes.has('KeyS') ? 1 : 0);
    state.brake = codes.has('Space') ? 1 : 0;
    state.steer = (codes.has('KeyA') ? 1 : 0) - (codes.has('KeyD') ? 1 : 0);
  };

  const onDown = (e: KeyboardEvent) => {
    codes.add(e.code);
    update();
  };
  const onUp = (e: KeyboardEvent) => {
    codes.delete(e.code);
    update();
  };

  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);

  return {
    state,
    dispose: () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    },
  };
}
