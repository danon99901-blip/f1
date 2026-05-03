// Event bus for decoupled communication between components

type EventHandler<T = any> = (data: T) => void;

export interface GameEvents {
  // State transitions
  'game:state-change': { from: string; to: string };

  // Network events
  'network:connected': void;
  'network:disconnected': { reason?: string };
  'network:reconnecting': { attempt: number };
  'network:room-created': { roomId: string; playerId: string };
  'network:room-joined': { roomId: string; playerId: string };
  'network:player-joined': { playerId: string; playerName: string };
  'network:player-left': { playerId: string };

  // Race events
  'race:countdown-start': { seconds: number };
  'race:start': void;
  'race:lap-complete': { playerId: string; lapNumber: number; lapTime: number };
  'race:finish': { playerId: string; position: number; totalTime: number };
  'race:all-finished': void;

  // Error events
  'error:fatal': { message: string; error?: Error };
  'error:network': { message: string };
  'error:physics': { message: string };
}

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<EventHandler>>();

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
    };
    this.on(event, wrappedHandler as EventHandler);
  }

  clear(): void {
    this.handlers.clear();
  }

  getHandlerCount(event: keyof GameEvents): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}
