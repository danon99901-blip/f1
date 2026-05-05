export interface InputState {
  /** Throttle, 0..1 (W). */
  throttle: number;
  /** Brake, 0..1 (S or Space). At standstill this is reinterpreted as reverse
   *  by the vehicle controller — there's no separate reverse key. */
  brake: number;
  /** Steering, -1..1 (A/D). Positive = left. */
  steer: number;
  /** ERS deployment request (E key - overtake button). */
  ersDeployRequested: boolean;
  /** DRS activation request (Q key). */
  drsRequested: boolean;
}

export function createInput(): { state: InputState; dispose: () => void } {
  const state: InputState = {
    throttle: 0,
    brake: 0,
    steer: 0,
    ersDeployRequested: false,
    drsRequested: false,
  };
  const codes = new Set<string>();

  const update = () => {
    state.throttle = codes.has('KeyW') ? 1 : 0;
    state.brake = codes.has('KeyS') || codes.has('Space') ? 1 : 0;
    state.steer = (codes.has('KeyA') ? 1 : 0) - (codes.has('KeyD') ? 1 : 0);
    state.ersDeployRequested = codes.has('KeyE');
    state.drsRequested = codes.has('KeyQ');
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
