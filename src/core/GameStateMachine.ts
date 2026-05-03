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
    if (this.transitioning) {
      throw new Error('Cannot transition while another transition is in progress');
    }

    const nextState = this.states.get(name);
    if (!nextState) {
      throw new Error(`State ${name} is not registered`);
    }

    this.transitioning = true;

    try {
      const fromName = this.currentState?.name ?? 'none';

      // Exit current state
      if (this.currentState) {
        await this.currentState.exit();
      }

      // Update context data
      if (data) {
        this.context.data = { ...this.context.data, ...data };
      }

      // Enter next state
      this.currentState = nextState;
      await this.currentState.enter(this.context);

      // Emit state change event
      this.context.eventBus.emit('game:state-change', { from: fromName, to: name });
    } finally {
      this.transitioning = false;
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

  async dispose(): Promise<void> {
    if (this.currentState) {
      await this.currentState.exit();
      this.currentState = null;
    }
    this.states.clear();
  }
}
