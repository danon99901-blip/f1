// Game session coordinating all services and state machine

import { GameStateMachine } from '../core/GameStateMachine';
import { GameLoop } from '../core/GameLoop';
import { EventBus } from '../core/EventBus';
import { ServiceContainer } from '../core/ServiceContainer';
import { PhysicsService } from '../services/PhysicsService';
import { RenderService } from '../services/RenderService';
import { NetworkService } from '../services/NetworkService';
import { InputService } from '../services/InputService';

export class GameSession {
  private eventBus: EventBus;
  private serviceContainer: ServiceContainer;
  private stateMachine: GameStateMachine;
  private gameLoop: GameLoop;
  private initialized = false;

  constructor() {
    this.eventBus = new EventBus();
    this.serviceContainer = new ServiceContainer();
    this.stateMachine = new GameStateMachine(this.eventBus);
    this.gameLoop = new GameLoop((dt) => this.update(dt));

    this.setupErrorHandling();
  }

  async init(container: HTMLElement, signalingUrl: string): Promise<void> {
    if (this.initialized) {
      throw new Error('GameSession already initialized');
    }

    // Register services
    this.serviceContainer.register('physics', () => new PhysicsService());
    this.serviceContainer.register('render', () => new RenderService());
    this.serviceContainer.register('input', () => new InputService());
    this.serviceContainer.register(
      'network',
      () => new NetworkService({ signalingUrl, eventBus: this.eventBus })
    );

    // Initialize core services
    await this.serviceContainer.resolve<PhysicsService>('physics');
    const renderService = await this.serviceContainer.resolve<RenderService>('render');
    renderService.initWithContainer(container);
    await this.serviceContainer.resolve<InputService>('input');

    this.initialized = true;
  }

  registerStates(states: Map<string, any>): void {
    states.forEach((state, name) => {
      this.stateMachine.registerState(name as any, state);
    });
  }

  async start(initialState: string): Promise<void> {
    if (!this.initialized) {
      throw new Error('GameSession not initialized');
    }

    await this.stateMachine.transitionTo(initialState as any);
    this.gameLoop.start();
  }

  private update(dt: number): void {
    this.stateMachine.update(dt);
  }

  async transitionTo(state: string, data?: Record<string, any>): Promise<void> {
    await this.stateMachine.transitionTo(state as any, data);
  }

  getEventBus(): EventBus {
    return this.eventBus;
  }

  getServiceContainer(): ServiceContainer {
    return this.serviceContainer;
  }

  getStateMachine(): GameStateMachine {
    return this.stateMachine;
  }

  pauseGame(): void {
    this.gameLoop.pause();
  }

  resumeGame(): void {
    this.gameLoop.resume();
  }

  private setupErrorHandling(): void {
    this.eventBus.on('error:fatal', ({ message, error }) => {
      console.error('[GameSession] Fatal error:', message, error);
      this.gameLoop.pause();
      // Transition to error state or menu
      this.transitionTo('menu').catch(console.error);
    });

    this.eventBus.on('error:network', ({ message }) => {
      console.error('[GameSession] Network error:', message);
    });

    this.eventBus.on('error:physics', ({ message }) => {
      console.error('[GameSession] Physics error:', message);
    });
  }

  async dispose(): Promise<void> {
    this.gameLoop.stop();
    await this.stateMachine.dispose();
    await this.serviceContainer.disposeAll();
    this.eventBus.clear();
    this.initialized = false;
  }
}
