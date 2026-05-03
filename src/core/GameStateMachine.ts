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
  private transitionQueue: Array<{ name: GameStateName; data?: Record<string, any> }> = [];

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
      this.transitionQueue.push({ name, data });
      return;
    }

    const nextState = this.states.get(name);
    if (!nextState) {
      console.error('[GameStateMachine] State not found:', name);
      throw new Error(`State ${name} is not registered`);
    }

    this.transitioning = true;
    console.log('[GameStateMachine] Transition started');

    try {
      const fromName = this.currentState?.name ?? 'none';
      console.log('[GameStateMachine] Exiting current state:', fromName);

      // Exit current state
      if (this.currentState) {
        await this.currentState.exit();
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
    this.transitionQueue = [];
  }

  private processQueue(): void {
    if (this.transitionQueue.length > 0) {
      const next = this.transitionQueue.shift();
      if (next) {
        console.log('[GameStateMachine] Processing queued transition:', next.name);
        // Schedule on next tick to avoid deep recursion
        setTimeout(() => {
          this.transitionTo(next.name, next.data).catch((error) => {
            console.error('[GameStateMachine] Queued transition failed:', error);
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
