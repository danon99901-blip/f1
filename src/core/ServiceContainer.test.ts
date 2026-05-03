import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceContainer, type Service } from './ServiceContainer';

describe('ServiceContainer', () => {
  let container: ServiceContainer;

  beforeEach(() => {
    container = new ServiceContainer();
  });

  it('should register and resolve services', async () => {
    const mockService: Service = {
      init: vi.fn(),
    };

    container.register('test', () => mockService);
    const resolved = await container.resolve('test');

    expect(resolved).toBe(mockService);
    expect(mockService.init).toHaveBeenCalled();
  });

  it('should return same instance on multiple resolves', async () => {
    const mockService: Service = {
      init: vi.fn(),
    };

    container.register('test', () => mockService);
    const instance1 = await container.resolve('test');
    const instance2 = await container.resolve('test');

    expect(instance1).toBe(instance2);
    expect(mockService.init).toHaveBeenCalledTimes(1);
  });

  it('should throw when resolving unregistered service', async () => {
    await expect(container.resolve('nonexistent')).rejects.toThrow('Service nonexistent is not registered');
  });

  it('should throw when registering duplicate service', () => {
    const mockService: Service = {};

    container.register('test', () => mockService);
    expect(() => container.register('test', () => mockService)).toThrow('Service test is already registered');
  });

  it('should check if service exists with has()', () => {
    const mockService: Service = {};

    expect(container.has('test')).toBe(false);

    container.register('test', () => mockService);
    expect(container.has('test')).toBe(true);
  });

  it('should support services without init method', async () => {
    const mockService: Service = {};

    container.register('test', () => mockService);
    const resolved = await container.resolve('test');

    expect(resolved).toBe(mockService);
  });

  it('should support async init methods', async () => {
    const mockService: Service = {
      init: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }),
    };

    container.register('test', () => mockService);
    await container.resolve('test');

    expect(mockService.init).toHaveBeenCalled();
  });

  it('should dispose all services', async () => {
    const service1: Service = {
      dispose: vi.fn(),
    };

    const service2: Service = {
      dispose: vi.fn(),
    };

    container.register('service1', () => service1);
    container.register('service2', () => service2);

    await container.resolve('service1');
    await container.resolve('service2');
    await container.disposeAll();

    expect(service1.dispose).toHaveBeenCalled();
    expect(service2.dispose).toHaveBeenCalled();
  });

  it('should handle dispose errors gracefully', async () => {
    const errorService: Service = {
      dispose: vi.fn(async () => {
        throw new Error('Dispose error');
      }),
    };

    const normalService: Service = {
      dispose: vi.fn(),
    };

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    container.register('error', () => errorService);
    container.register('normal', () => normalService);

    await container.resolve('error');
    await container.resolve('normal');
    await container.disposeAll();

    expect(errorService.dispose).toHaveBeenCalled();
    expect(normalService.dispose).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should clear all services and factories', () => {
    const mockService: Service = {};

    container.register('test', () => mockService);
    container.clear();

    expect(container.has('test')).toBe(false);
  });

  it('should support dependency injection between services', async () => {
    interface ServiceA extends Service {
      name: string;
    }

    interface ServiceB extends Service {
      name: string;
      dependency: ServiceA | null;
    }

    const serviceA: ServiceA = {
      name: 'A',
    };

    const serviceB: ServiceB = {
      name: 'B',
      dependency: null,
      init: async function (this: ServiceB) {
        this.dependency = await container.resolve<ServiceA>('serviceA');
      },
    };

    container.register('serviceA', () => serviceA);
    container.register('serviceB', () => serviceB);

    const resolvedB = await container.resolve<ServiceB>('serviceB');

    expect(resolvedB.dependency).toBe(serviceA);
  });
});
