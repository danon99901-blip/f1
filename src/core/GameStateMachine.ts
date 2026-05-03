// Game state machine with explicit state transitions

import type { EventBus } from './EventBus';

export interface GameState {
  readonly name: string;
  enter(context: StateContext): Promise<void> | void;
  update(dt: number): void;
  exit(): Promise<void> | void;
}

export interface StateContext {
  eventBus: EventBus;
  data?: Record<string, any>;
}

export type GameStateName = 'menu' | 'lobby' | 'countdown' | 'racing' | 'results';

export class GameStateMachine {
  private currentState: GameState | null = null;
  private states = new Map<GameStateName, GameState>();
  private context: StateContext;
  private transitioning = false;
  private transitionQueue: Array<{
    name: GameStateName;
    data?: Record<string, any>;
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(eventBus: EventBus) {
    this.context = { eventBus, data: {} };
  }

  registerState(name: GameStateName, state: GameState): void {
    if (this.states.has(name)) {
      throw new Error(`State ${name} is already registered`);
    }
    this.states.set(name, state);
  }

  async transitionTo(name: GameStateName, data?: Record<string, any>): Promise<void> {
    console.log('[GameStateMachine] transitionTo called:', name);

    // If already transitioning, queue this transition
    if (this.transitioning) {
      console.log('[GameStateMachine] Already transitioning, queueing:', name);
      return new Promise<void>((resolve, reject) => {
        this.transitionQueue.push({ name, data, resolve, reject });
      });
    }

    const nextState = this.states.get(name);
    if (!nextState) {
      console.error('[GameStateMachine] State not found:', name);
      throw new Error(`State ${name} is not registered`);
    }

    this.transitioning = true;
    console.log('[GameStateMachine] Transition started');

    const previousState = this.currentState;
    const fromName = previousState?.name ?? 'none';

    try {
      console.log('[GameStateMachine] Exiting current state:', fromName);

      // Exit current state
      if (previousState) {
        await previousState.exit();
        console.log('[GameStateMachine] Current state exited');
      }

      // Update context data
      if (data) {
        this.context.data = { ...this.context.data, ...data };
      }

      console.log('[GameStateMachine] Entering new state:', name);
      // Enter next state
      this.currentState = nextState;
      await this.currentState.enter(this.context);
      console.log('[GameStateMachine] New state entered successfully');

      // Emit state change event
      this.context.eventBus.emit('game:state-change', { from: fromName, to: name });
      console.log('[GameStateMachine] State change event emitted');
    } catch (error) {
      console.error('[GameStateMachine] Transition failed:', error);

      // Rollback: restore previous state if enter() failed
      if (this.currentState === nextState) {
        console.warn('[GameStateMachine] Rolling back to previous state:', fromName);
        this.currentState = previousState;

        // If we had a previous state, try to re-enter it to restore consistency
        if (previousState) {
          try {
            console.log('[GameStateMachine] Re-entering previous state for rollback');
            await previousState.enter(this.context);
            console.log('[GameStateMachine] Rollback successful, restored to:', fromName);
          } catch (rollbackError) {
            console.error('[GameStateMachine] Rollback failed:', rollbackError);
            // If rollback fails, we're in an inconsistent state - set to null
            this.currentState = null;
            console.error('[GameStateMachine] State machine is now in inconsistent state (null)');
          }
        }
      }

      throw error;
    } finally {
      this.transitioning = false;
      console.log('[GameStateMachine] Transition complete');

      // Process queued transitions
      this.processQueue();
    }
  }

  update(dt: number): void {
    if (this.currentState && !this.transitioning) {
      this.currentState.update(dt);
    }
  }

  getCurrentState(): GameState | null {
    return this.currentState;
  }

  getCurrentStateName(): GameStateName | null {
    if (!this.currentState) return null;
    return this.currentState.name as GameStateName;
  }

  getContext(): StateContext {
    return this.context;
  }

  clearQueue(): void {
    console.log('[GameStateMachine] Clearing transition queue');
    // Reject all pending transitions
    this.transitionQueue.forEach((item) => {
      item.reject(new Error('Transition queue cleared'));
    });
    this.transitionQueue = [];
  }

  private processQueue(): void {
    if (this.transitionQueue.length > 0) {
      const next = this.transitionQueue.shift();
      if (next) {
        console.log('[GameStateMachine] Processing queued transition:', next.name);
        // Schedule on next tick to avoid deep recursion
        setTimeout(() => {
          this.transitionTo(next.name, next.data)
            .then(() => next.resolve())
            .catch((error) => {
              console.error('[GameStateMachine] Queued transition failed:', error);
              next.reject(error);
              this.clearQueue();
            });
        }, 0);
      }
    }
  }

  async dispose(): Promise<void> {
    this.clearQueue();
    if (this.currentState) {
      await this.currentState.exit();
      this.currentState = null;
    }
    this.states.clear();
  }
}
