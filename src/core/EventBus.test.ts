import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './EventBus';

describe('EventBus', () => {
  it('should emit events to registered handlers', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('game:state-change', handler);
    bus.emit('game:state-change', { from: 'menu', to: 'racing' });

    expect(handler).toHaveBeenCalledWith({ from: 'menu', to: 'racing' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should support multiple handlers for the same event', () => {
    const bus = new EventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on('race:start', handler1);
    bus.on('race:start', handler2);
    bus.emit('race:start', undefined);

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it('should remove handlers with off()', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('race:start', handler);
    bus.off('race:start', handler);
    bus.emit('race:start', undefined);

    expect(handler).not.toHaveBeenCalled();
  });

  it('should support once() for single-fire handlers', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.once('race:start', handler);
    bus.emit('race:start', undefined);
    bus.emit('race:start', undefined);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should handle errors in handlers gracefully', () => {
    const bus = new EventBus();
    const errorHandler = vi.fn(() => {
      throw new Error('Handler error');
    });
    const normalHandler = vi.fn();

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    bus.on('race:start', errorHandler);
    bus.on('race:start', normalHandler);
    bus.emit('race:start', undefined);

    expect(errorHandler).toHaveBeenCalled();
    expect(normalHandler).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should clear all handlers', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('race:start', handler);
    bus.clear();
    bus.emit('race:start', undefined);

    expect(handler).not.toHaveBeenCalled();
  });

  it('should return correct handler count', () => {
    const bus = new EventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    expect(bus.getHandlerCount('race:start')).toBe(0);

    bus.on('race:start', handler1);
    expect(bus.getHandlerCount('race:start')).toBe(1);

    bus.on('race:start', handler2);
    expect(bus.getHandlerCount('race:start')).toBe(2);

    bus.off('race:start', handler1);
    expect(bus.getHandlerCount('race:start')).toBe(1);
  });
});
