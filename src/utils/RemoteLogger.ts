// Remote logger that sends logs to Railway server
// Disabled by default to avoid spamming production
// Enable with: VITE_ENABLE_REMOTE_LOGGING=true

const LOG_ENDPOINT = 'https://f1-production-c1df.up.railway.app/log';

function isLoggingEnabled(): boolean {
  try {
    return import.meta.env?.VITE_ENABLE_REMOTE_LOGGING === 'true';
  } catch {
    return false;
  }
}

export class RemoteLogger {
  private static queue: any[] = [];
  private static sending = false;

  static log(level: 'info' | 'error' | 'warn', message: string, data?: any) {
    // Always log to console
    console[level](`[${level.toUpperCase()}]`, message, data || '');

    if (!isLoggingEnabled()) return;

    const logEntry = {
      level,
      message,
      data,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
    };

    // Queue for remote logging
    this.queue.push(logEntry);

    // Send immediately (don't wait for batching)
    setTimeout(() => this.flush(), 0);
  }

  private static async flush() {
    if (this.sending || this.queue.length === 0) return;

    this.sending = true;
    const batch = [...this.queue];
    this.queue = [];

    try {
      await fetch(LOG_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: batch }),
      });
    } catch (error) {
      console.error('[RemoteLogger] Failed to send logs:', error);
    } finally {
      this.sending = false;
      // If more logs were queued while sending, flush again
      if (this.queue.length > 0) {
        setTimeout(() => this.flush(), 100);
      }
    }
  }
}

// Global error handler (only if logging enabled) - setup lazily
setTimeout(() => {
  if (isLoggingEnabled()) {
    window.addEventListener('error', (event) => {
      RemoteLogger.log('error', 'Uncaught error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      RemoteLogger.log('error', 'Unhandled promise rejection', {
        reason: event.reason,
      });
    });
  }
}, 0);
