// Dependency injection container for services

import type { NetworkService } from '../services/NetworkService';
import type { PhysicsService } from '../services/PhysicsService';
import type { RenderService } from '../services/RenderService';
import type { InputService } from '../services/InputService';

export interface Service {
  init?(): Promise<void> | void;
  dispose?(): Promise<void> | void;
}

type ServiceFactory<T extends Service> = (container: ServiceContainer) => T;

// Type map for registered services - extend this when adding new services
export interface ServiceMap {
  network: NetworkService;
  physics: PhysicsService;
  render: RenderService;
  input: InputService;
}

export class ServiceContainer {
  private services = new Map<string, Service>();
  private factories = new Map<string, ServiceFactory<any>>();
  private initialized = new Set<string>();
  private resolving = new Set<string>();

  register<T extends Service>(name: string, factory: ServiceFactory<T>): void {
    if (this.factories.has(name)) {
      throw new Error(`Service ${name} is already registered`);
    }
    this.factories.set(name, factory);
  }

  async resolve<K extends keyof ServiceMap>(name: K): Promise<ServiceMap[K]>;
  async resolve<T extends Service>(name: string): Promise<T>;
  async resolve<T extends Service>(name: string): Promise<T> {
    // Return existing instance if already created
    if (this.services.has(name)) {
      const cached = this.services.get(name) as T;
      console.log(`[ServiceContainer] Returning cached service: ${name}`, cached);
      return cached;
    }

    // Check for circular dependency
    if (this.resolving.has(name)) {
      const chain = Array.from(this.resolving).join(' -> ');
      throw new Error(
        `Circular dependency detected: ${chain} -> ${name}. ` +
        `Services cannot depend on each other in a cycle.`
      );
    }

    // Get factory
    const factory = this.factories.get(name);
    if (!factory) {
      throw new Error(`Service ${name} is not registered`);
    }

    console.log(`[ServiceContainer] Creating new service: ${name}`);

    // Mark as resolving
    this.resolving.add(name);

    try {
      // Create instance (factory may return Promise<Service>)
      const service = await factory(this);

      // Validate service
      if (!service) {
        throw new Error(`Factory for ${name} returned null or undefined`);
      }

      console.log(`[ServiceContainer] Service created: ${name}`, service);
      console.log(`[ServiceContainer] Service type: ${typeof service}, constructor: ${service.constructor.name}`);

      this.services.set(name, service);

      // Initialize if needed
      if (service.init && !this.initialized.has(name)) {
        console.log(`[ServiceContainer] Initializing service: ${name}`);
        await service.init();
        this.initialized.add(name);
      }

      return service as T;
    } finally {
      // Always remove from resolving set
      this.resolving.delete(name);
    }
  }

  has(name: string): boolean {
    return this.factories.has(name) || this.services.has(name);
  }

  get<T extends Service>(name: string): T {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service ${name} is not initialized. Call resolve() first.`);
    }
    return service as T;
  }

  async disposeAll(): Promise<void> {
    const disposePromises: Promise<void>[] = [];

    for (const [name, service] of this.services.entries()) {
      if (service.dispose) {
        disposePromises.push(
          Promise.resolve(service.dispose()).catch((err) => {
            console.error(`[ServiceContainer] Error disposing ${name}:`, err);
          })
        );
      }
    }

    await Promise.all(disposePromises);

    this.services.clear();
    this.initialized.clear();
  }

  clear(): void {
    this.services.clear();
    this.factories.clear();
    this.initialized.clear();
    this.resolving.clear();
  }
}
