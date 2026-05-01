export interface InputState {
  forward: number;
  brake: number;
  steer: number;
}

export function createInput(): { state: InputState; dispose: () => void } {
  const state: InputState = { forward: 0, brake: 0, steer: 0 };
  const keys = new Set<string>();

  const update = () => {
    state.forward = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
    state.brake = keys.has(' ') ? 1 : 0;
    state.steer = (keys.has('a') || keys.has('arrowleft') ? 1 : 0) - (keys.has('d') || keys.has('arrowright') ? 1 : 0);
  };

  const onDown = (e: KeyboardEvent) => { keys.add(e.key.toLowerCase()); update(); };
  const onUp = (e: KeyboardEvent) => { keys.delete(e.key.toLowerCase()); update(); };

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
