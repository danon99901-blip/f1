import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameStateMachine, type GameState, type StateContext } from './GameStateMachine';
import { EventBus } from './EventBus';

describe('GameStateMachine', () => {
  let eventBus: EventBus;
  let stateMachine: GameStateMachine;

  beforeEach(() => {
    eventBus = new EventBus();
    stateMachine = new GameStateMachine(eventBus);
  });

  it('should register states', () => {
    const mockState: GameState = {
      name: 'test',
      enter: vi.fn(),
      update: vi.fn(),
      exit: vi.fn(),
    };

    expect(() => stateMachine.registerState('menu', mockState)).not.toThrow();
  });

  it('should throw when registering duplicate state', () => {
    const mockState: GameState = {
      name: 'test',
      enter: vi.fn(),
      update: vi.fn(),
      exit: vi.fn(),
    };

    stateMachine.registerState('menu', mockState);
    expect(() => stateMachine.registerState('menu', mockState)).toThrow('State menu is already registered');
  });

  it('should transition to registered state', async () => {
    const mockState: GameState = {
      name: 'menu',
      enter: vi.fn(),
      update: vi.fn(),
      exit: vi.fn(),
    };

    stateMachine.registerState('menu', mockState);
    await stateMachine.transitionTo('menu');

    expect(mockState.enter).toHaveBeenCalled();
    expect(stateMachine.getCurrentStateName()).toBe('menu');
  });

  it('should throw when transitioning to unregistered state', async () => {
    await expect(stateMachine.transitionTo('menu')).rejects.toThrow('State menu is not registered');
  });

  it('should call exit on previous state when transitioning', async () => {
    const state1: GameState = {
      name: 'menu',
      enter: vi.fn(),
      update: vi.fn(),
      exit: vi.fn(),
    };

    const state2: GameState = {
      name: 'racing',
      enter: vi.fn(),
      update: vi.fn(),
      exit: vi.fn(),
    };

    stateMachine.registerState('menu', state1);
    stateMachine.registerState('racing', state2);

    await stateMachine.transitionTo('menu');
    await stateMachine.transitionTo('racing');

    expect(state1.exit).toHaveBeenCalled();
    expect(state2.enter).toHaveBeenCalled();
  });

  it('should emit state-change event on transition', async () => {
    const handler = vi.fn();
    eventBus.on('game:state-change', handler);

    const mockState: GameState = {
      name: 'menu',
      enter: vi.fn(),
      update: vi.fn(),
      exit: vi.fn(),
    };

    stateMachine.registerState('menu', mockState);
    await stateMachine.transitionTo('menu');

    expect(handler).toHaveBeenCalledWith({ from: 'none', to: 'menu' });
  });

  it('should pass data to state context', async () => {
    let receivedContext: StateContext | null = null;

    const mockState: GameState = {
      name: 'racing',
      enter: (context) => {
        receivedContext = context;
      },
      update: vi.fn(),
      exit: vi.fn(),
    };

    stateMachine.registerState('racing', mockState);
    await stateMachine.transitionTo('racing', { totalLaps: 10 });

    expect(receivedContext).not.toBeNull();
    expect(receivedContext!.data).toBeDefined();
    expect((receivedContext!.data as any).totalLaps).toBe(10);
  });

  it('should prevent concurrent transitions', async () => {
    const slowState: GameState = {
      name: 'menu',
      enter: () => new Promise((resolve) => setTimeout(resolve, 100)),
      update: vi.fn(),
      exit: vi.fn(),
    };

    stateMachine.registerState('menu', slowState);

    const transition1 = stateMachine.transitionTo('menu');

    // Wait a bit to ensure first transition has started
    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(stateMachine.transitionTo('menu')).rejects.toThrow('Cannot transition while another transition is in progress');

    // Wait for first transition to complete
    await transition1;
  });

  it('should update current state', () => {
    const mockState: GameState = {
      name: 'racing',
      enter: vi.fn(),
      update: vi.fn(),
      exit: vi.fn(),
    };

    stateMachine.registerState('racing', mockState);
    stateMachine.transitionTo('racing');

    // Wait for transition to complete
    setTimeout(() => {
      stateMachine.update(0.016);
      expect(mockState.update).toHaveBeenCalledWith(0.016);
    }, 10);
  });

  it('should dispose and clean up', async () => {
    const mockState: GameState = {
      name: 'menu',
      enter: vi.fn(),
      update: vi.fn(),
      exit: vi.fn(),
    };

    stateMachine.registerState('menu', mockState);
    await stateMachine.transitionTo('menu');
    await stateMachine.dispose();

    expect(mockState.exit).toHaveBeenCalled();
    expect(stateMachine.getCurrentState()).toBeNull();
  });
});
