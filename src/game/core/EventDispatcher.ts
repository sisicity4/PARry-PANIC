type Listener<T> = (payload: T) => void;

export class EventDispatcher<TEvents extends object> {
  private listeners: {
    [K in keyof TEvents]?: Set<Listener<TEvents[K]>>;
  } = {};

  on<K extends keyof TEvents>(eventName: K, listener: Listener<TEvents[K]>): () => void {
    if (!this.listeners[eventName]) {
      this.listeners[eventName] = new Set();
    }
    this.listeners[eventName]?.add(listener);

    return () => this.off(eventName, listener);
  }

  off<K extends keyof TEvents>(eventName: K, listener: Listener<TEvents[K]>): void {
    this.listeners[eventName]?.delete(listener);
  }

  emit<K extends keyof TEvents>(eventName: K, payload: TEvents[K]): void {
    for (const listener of this.listeners[eventName] ?? []) {
      listener(payload);
    }
  }

  clear(): void {
    for (const eventName in this.listeners) {
      this.listeners[eventName as keyof TEvents]?.clear();
    }
  }
}
