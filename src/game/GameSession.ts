// Game session coordinating all services and state machine

import { GameStateMachine } from '../core/GameStateMachine';
import { GameLoop } from '../core/GameLoop';
import { EventBus } from '../core/EventBus';
import { ServiceContainer } from '../core/ServiceContainer';
import { PhysicsService } from '../services/PhysicsService';
import { RenderService } from '../services/RenderService';
import { NetworkService } from '../services/NetworkService';
import { InputService } from '../services/InputService';
import { RemoteLogger } from '../utils/RemoteLogger';

export class GameSession {
  private eventBus: EventBus;
  private serviceContainer: ServiceContainer;
  private stateMachine: GameStateMachine;
  private gameLoop: GameLoop;
  private initialized = false;

  private renderService: RenderService | null = null;

  constructor() {
    this.eventBus = new EventBus();
    this.serviceContainer = new ServiceContainer();
    this.stateMachine = new GameStateMachine(this.eventBus);
    this.gameLoop = new GameLoop((dt) => this.update(dt));

    // Add serviceContainer to state machine context
    this.stateMachine.getContext().data = {
      serviceContainer: this.serviceContainer,
    };

    this.setupErrorHandling();
  }

  async init(container: HTMLElement, signalingUrl: string): Promise<void> {
    if (this.initialized) {
      throw new Error('GameSession already initialized');
    }

    RemoteLogger.log('info', '[GameSession] Starting initialization...');

    // Register services
    this.serviceContainer.register('physics', () => new PhysicsService());
    this.serviceContainer.register('render', () => new RenderService());
    this.serviceContainer.register('input', () => new InputService());

    // Register network service with explicit typing
    this.serviceContainer.register<NetworkService>(
      'network',
      () => {
        const service = new NetworkService({ signalingUrl, eventBus: this.eventBus });
        console.log('[GameSession] NetworkService factory called, created:', service);
        console.log('[GameSession] NetworkService has connect:', typeof service.connect);
        return service;
      }
    );

    RemoteLogger.log('info', '[GameSession] Services registered');

    // Initialize only render service (physics will be initialized when needed)
    RemoteLogger.log('info', '[GameSession] Initializing render...');
    this.renderService = await this.serviceContainer.resolve<RenderService>('render');
    this.renderService.initWithContainer(container);

    RemoteLogger.log('info', '[GameSession] Initializing input...');
    await this.serviceContainer.resolve<InputService>('input');

    RemoteLogger.log('info', '[GameSession] Initialization complete!');
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
    // Per-frame profiling. Accumulates per-phase time and dumps once per second
    // so we can see where the budget actually goes when fps drops below target.
    // Enable via ?profile=1 query param (URL-toggled, no rebuild needed).
    if (this._profileEnabled === undefined) {
      this._profileEnabled = false;
      // Guard against window/URL being unavailable in test environments.
      if (typeof window !== 'undefined') {
        try {
          this._profileEnabled = new URL(window.location.href).searchParams.get('profile') === '1';
        } catch {
          // ignore — non-parseable test URL
        }
      }
      if (this._profileEnabled) {
        this._profileAcc = { state: 0, render: 0, frames: 0 };
        this._profileLastDump = performance.now();
        console.warn('[GameSession] Per-frame profiling ENABLED via ?profile=1');
      }
    }

    if (this._profileEnabled) {
      const t0 = performance.now();
      this.stateMachine.update(dt);
      const t1 = performance.now();
      if (this.renderService) this.renderService.render(dt);
      const t2 = performance.now();
      this._profileAcc!.state += t1 - t0;
      this._profileAcc!.render += t2 - t1;
      this._profileAcc!.frames++;
      if (t2 - this._profileLastDump! >= 1000) {
        const f = this._profileAcc!.frames;
        const stateMs = (this._profileAcc!.state / f).toFixed(2);
        const renderMs = (this._profileAcc!.render / f).toFixed(2);
        const totalMs = ((this._profileAcc!.state + this._profileAcc!.render) / f).toFixed(2);
        const targetMs = (1000 / 60).toFixed(2);
        console.log(
          `[Profile] avg/frame: state=${stateMs}ms render=${renderMs}ms total=${totalMs}ms ` +
          `(target: ${targetMs}ms for 60fps) — fps=${Math.round(f * 1000 / (t2 - this._profileLastDump!))}`
        );
        this._profileAcc = { state: 0, render: 0, frames: 0 };
        this._profileLastDump = t2;
      }
    } else {
      this.stateMachine.update(dt);
      if (this.renderService) this.renderService.render(dt);
    }
  }

  private _profileEnabled?: boolean;
  private _profileAcc?: { state: number; render: number; frames: number };
  private _profileLastDump?: number;

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

  getGameLoop(): GameLoop {
    return this.gameLoop;
  }

  getNetworkService(): NetworkService | null {
    try {
      return this.serviceContainer.get<NetworkService>('network');
    } catch {
      return null;
    }
  }

  pauseGame(): void {
    this.gameLoop.pause();
  }

  resumeGame(): void {
    this.gameLoop.resume();
  }

  private setupErrorHandling(): void {
    // Handle state change requests from states (but not from GameStateMachine itself)
    this.eventBus.on('game:request-state-change', ({ to, data }) => {
      console.log('[GameSession] State change requested:', to);
      this.transitionTo(to, data).catch((err) => {
        console.error('[GameSession] State transition failed:', err);
        this.eventBus.emit('error:fatal', { message: 'State transition failed', error: err });
      });
    });

    this.eventBus.on('error:fatal', ({ message, error }) => {
      console.error('[GameSession] Fatal error:', message, error);
      this.gameLoop.pause();
      // Transition to menu (but don't create infinite loop)
      if (this.stateMachine.getCurrentStateName() !== 'menu') {
        this.transitionTo('menu').catch(console.error);
      }
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
