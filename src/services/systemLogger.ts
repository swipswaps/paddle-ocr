export type LogType = 'system' | 'ocr' | 'error';

export interface LogEntry {
  type: LogType;
  message: string;
  timestamp: number;
}

type LogListener = (log: LogEntry) => void;

class SystemLogger {
  private listeners: LogListener[] = [];

  info(type: LogType, message: string, timestamp: number = Date.now()) {
    this.notify({ type, message, timestamp });
  }

  error(type: LogType, message: string, timestamp: number = Date.now()) {
    this.notify({ type, message, timestamp });
  }

  addListener(listener: LogListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify(entry: LogEntry) {
    this.listeners.forEach(l => l(entry));
  }
}

export const systemLogger = new SystemLogger();