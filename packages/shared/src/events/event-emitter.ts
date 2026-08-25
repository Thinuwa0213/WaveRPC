import { WaveRPCEvents, EventName } from './types.js';

export class TypedEventEmitter {
  private listeners: Map<EventName, Set<Function>> = new Map();

  public on<K extends EventName>(event: K, listener: WaveRPCEvents[K]): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);

    return () => this.off(event, listener);
  }

  public off<K extends EventName>(event: K, listener: WaveRPCEvents[K]): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(listener);
    }
  }

  public emit<K extends EventName>(event: K, ...args: Parameters<WaveRPCEvents[K]>): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      for (const listener of eventListeners) {
        listener(...args);
      }
    }
  }

  public removeAllListeners(event?: EventName): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}
