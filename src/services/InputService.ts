// Input service abstracting keyboard/gamepad input

import type { InputState } from '../shared/types';
import type { Service } from '../core/ServiceContainer';

export class InputService implements Service {
  private input: InputState = { throttle: 0, brake: 0, steer: 0 };
  private codes = new Set<string>();
  private enabled = false;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private onKeyUp: ((e: KeyboardEvent) => void) | null = null;

  init(): void {
    this.onKeyDown = (e: KeyboardEvent) => {
      if (!this.enabled) return;
      this.codes.add(e.code);
      this.updateInput();
    };

    this.onKeyUp = (e: KeyboardEvent) => {
      if (!this.enabled) return;
      this.codes.delete(e.code);
      this.updateInput();
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
    this.codes.clear();
    this.input = { throttle: 0, brake: 0, steer: 0 };
  }

  getInput(): InputState {
    return { ...this.input };
  }

  private updateInput(): void {
    this.input.throttle = this.codes.has('KeyW') ? 1 : 0;
    this.input.brake = this.codes.has('KeyS') || this.codes.has('Space') ? 1 : 0;
    this.input.steer = (this.codes.has('KeyA') ? 1 : 0) - (this.codes.has('KeyD') ? 1 : 0);
  }

  dispose(): void {
    if (this.onKeyDown) {
      window.removeEventListener('keydown', this.onKeyDown);
      this.onKeyDown = null;
    }
    if (this.onKeyUp) {
      window.removeEventListener('keyup', this.onKeyUp);
      this.onKeyUp = null;
    }
    this.codes.clear();
    this.enabled = false;
  }
}
