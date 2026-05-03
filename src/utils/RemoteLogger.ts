// Remote logger that sends logs to Railway server

const LOGGING_ENABLED = true;
const LOG_ENDPOINT = 'https://f1-production-c1df.up.railway.app/log';

export class RemoteLogger {
  private static queue: any[] = [];
  private static sending = false;

  static log(level: 'info' | 'error' | 'warn', message: string, data?: any) {
    const logEntry = {
      level,
      message,
      data,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
    };

    // Always log to console
    console[level](`[${level.toUpperCase()}]`, message, data || '');

    if (!LOGGING_ENABLED) return;

    // Queue for remote logging
    this.queue.push(logEntry);
    this.flush();
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
    }
  }
}

// Global error handler
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
