// Countdown state - pre-race countdown

import type { GameState, StateContext } from '../core/GameStateMachine';
import { CountdownOverlay } from '../client/game/CountdownOverlay';

export class CountdownState implements GameState {
  readonly name = 'countdown';
  private countdown: CountdownOverlay | null = null;
  private context: StateContext | null = null;
  private transitionRequested = false;

  async enter(context: StateContext): Promise<void> {
    this.context = context;
    this.transitionRequested = false;
    const countdownSeconds = context.data?.countdownSeconds ?? 5;

    this.countdown = new CountdownOverlay();
    this.countdown.show(countdownSeconds, () => {
      if (this.context && !this.transitionRequested) {
        // Mark transition as requested to prevent duplicate transitions
        this.transitionRequested = true;
        console.log('[CountdownState] Requesting transition to racing (first request)');

        // Defer state change to avoid race condition during enter()
        setTimeout(() => {
          if (this.context) {
            this.context.eventBus.emit('game:request-state-change', { from: 'countdown', to: 'racing' });
          }
        }, 0);
      } else if (this.transitionRequested) {
        console.warn('[CountdownState] Transition already requested, ignoring duplicate request');
      }
    });
  }

  update(_dt: number): void {
    // Countdown is timer-based, no updates needed
  }

  async exit(): Promise<void> {
    this.countdown = null;
    this.context = null;
    this.transitionRequested = false;
  }
}
