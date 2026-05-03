// Network reconnect strategy with exponential backoff

import type { EventBus } from '../core/EventBus';

export interface ReconnectConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

export class ReconnectStrategy {
  private config: ReconnectConfig;
  private eventBus: EventBus;
  private attempts = 0;
  private reconnectTimer: number | null = null;
  private reconnectCallback: (() => Promise<void>) | null = null;

  constructor(eventBus: EventBus, config?: Partial<ReconnectConfig>) {
    this.eventBus = eventBus;
    this.config = {
      maxAttempts: config?.maxAttempts ?? 5,
      initialDelay: config?.initialDelay ?? 1000,
      maxDelay: config?.maxDelay ?? 30000,
      backoffMultiplier: config?.backoffMultiplier ?? 2,
    };
  }

  setReconnectCallback(callback: () => Promise<void>): void {
    this.reconnectCallback = callback;
  }

  async attemptReconnect(): Promise<boolean> {
    if (this.attempts >= this.config.maxAttempts) {
      this.eventBus.emit('error:fatal', {
        message: `Failed to reconnect after ${this.config.maxAttempts} attempts`,
      });
      return false;
    }

    this.attempts++;
    const delay = Math.min(
      this.config.initialDelay * Math.pow(this.config.backoffMultiplier, this.attempts - 1),
      this.config.maxDelay
    );

    this.eventBus.emit('network:reconnecting', { attempt: this.attempts });

    return new Promise((resolve) => {
      this.reconnectTimer = window.setTimeout(async () => {
        if (this.reconnectCallback) {
          try {
            await this.reconnectCallback();
            this.reset();
            resolve(true);
          } catch (error) {
            console.error('[ReconnectStrategy] Reconnect failed:', error);
            resolve(await this.attemptReconnect());
          }
        } else {
          resolve(false);
        }
      }, delay);
    });
  }

  reset(): void {
    this.attempts = 0;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  getAttempts(): number {
    return this.attempts;
  }

  dispose(): void {
    this.reset();
    this.reconnectCallback = null;
  }
}
