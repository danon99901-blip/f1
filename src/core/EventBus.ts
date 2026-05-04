// Event bus for decoupled communication between components

import type { NetworkErrorType } from '../client/network/NetworkClient';

type EventHandler<T = any> = (data: T) => void;

export interface GameEvents {
  // State transitions
  'game:state-change': { from: string; to: string };
  'game:request-state-change': { from: string; to: string; data?: any };

  // Network events
  'network:connected': void;
  'network:disconnected': { reason?: string };
  'network:reconnecting': { attempt: number };
  'network:room-created': { roomId: string; playerId: string };
  'network:room-joined': { roomId: string; playerId: string };
  'network:player-joined': { playerId: string; playerName: string };
  'network:player-left': { playerId: string };
  'network:player-color-changed': { playerId: string; color: number };
  'network:host-message': { message: any };
  'network:guest-message': { guestId: string; message: any };

  // Race events
  'race:countdown-start': { seconds: number };
  'race:start': void;
  'race:lap-complete': { playerId: string; lapNumber: number; lapTime: number };
  'race:finish': { playerId: string; position: number; totalTime: number };
  'race:all-finished': void;

  // Error events
  'error:fatal': { message: string; error?: Error };
  'error:network': { message: string; errorType?: NetworkErrorType };
  'error:physics': { message: string };
}

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<EventHandler>>();
  private onceHandlers = new Map<keyof GameEvents, Map<EventHandler, EventHandler>>();

  on<K extends keyof GameEvents>(event: K, handler: EventHandler<GameEvents[K]>): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off<K extends keyof GameEvents>(event: K, handler: EventHandler<GameEvents[K]>): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  emit<K extends keyof GameEvents>(event: K, data: GameEvents[K]): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          console.error(`[EventBus] Error in handler for ${event}:`, error);
        }
      });
    }
  }

  once<K extends keyof GameEvents>(event: K, handler: EventHandler<GameEvents[K]>): void {
    const wrappedHandler = (data: GameEvents[K]) => {
      handler(data);
      this.off(event, wrappedHandler as EventHandler);
      // Clean up the tracking map
      const onceMap = this.onceHandlers.get(event);
      if (onceMap) {
        onceMap.delete(handler);
        if (onceMap.size === 0) {
          this.onceHandlers.delete(event);
        }
      }
    };
    this.on(event, wrappedHandler as EventHandler);

    // Track the mapping for cleanup
    if (!this.onceHandlers.has(event)) {
      this.onceHandlers.set(event, new Map());
    }
    this.onceHandlers.get(event)!.set(handler, wrappedHandler as EventHandler);
  }

  clear(): void {
    this.handlers.clear();
    this.onceHandlers.clear();
  }

  clearOnce<K extends keyof GameEvents>(event: K, handler: EventHandler<GameEvents[K]>): void {
    const onceMap = this.onceHandlers.get(event);
    if (onceMap) {
      const wrappedHandler = onceMap.get(handler);
      if (wrappedHandler) {
        this.off(event, wrappedHandler);
        onceMap.delete(handler);
        if (onceMap.size === 0) {
          this.onceHandlers.delete(event);
        }
      }
    }
  }

  getHandlerCount(event: keyof GameEvents): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}
