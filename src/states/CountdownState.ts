// Countdown state - pre-race countdown

import type { GameState, StateContext } from '../core/GameStateMachine';
import { CountdownOverlay } from '../client/game/CountdownOverlay';

export class CountdownState implements GameState {
  readonly name = 'countdown';
  private countdown: CountdownOverlay | null = null;
  private context: StateContext | null = null;

  async enter(context: StateContext): Promise<void> {
    this.context = context;
    const countdownSeconds = context.data?.countdownSeconds ?? 5;

    this.countdown = new CountdownOverlay();
    this.countdown.show(countdownSeconds, () => {
      if (this.context) {
        // Defer state change to avoid race condition during enter()
        setTimeout(() => {
          if (this.context) {
            this.context.eventBus.emit('game:request-state-change', { from: 'countdown', to: 'racing' });
          }
        }, 0);
      }
    });
  }

  update(_dt: number): void {
    // Countdown is timer-based, no updates needed
  }

  async exit(): Promise<void> {
    this.countdown = null;
    this.context = null;
  }
}
