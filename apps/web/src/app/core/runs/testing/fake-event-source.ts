import type { RunEventType } from '../run-event.types';

/**
 * Deterministic EventSource double for transport, facade, and screen tests.
 *
 * jsdom does not implement EventSource, so the production factory is replaced
 * with this fake through `RUN_EVENT_SOURCE_FACTORY`.
 */
export class FakeEventSource {
  static readonly instances: FakeEventSource[] = [];

  static reset(): void {
    FakeEventSource.instances.length = 0;
  }

  static latest(): FakeEventSource {
    const source = FakeEventSource.instances.at(-1);
    if (source === undefined) {
      throw new Error('No FakeEventSource has been created.');
    }

    return source;
  }

  readonly url: string;
  readyState = 0;
  onopen: ((this: EventSource, event: Event) => unknown) | null = null;
  onerror: ((this: EventSource, event: Event) => unknown) | null = null;
  closed = false;

  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
    this.listeners.clear();
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.call(this as unknown as EventSource, new Event('open'));
  }

  emit(type: RunEventType, data: string, lastEventId = ''): void {
    if (this.closed) {
      return;
    }

    const event = new MessageEvent(type, { data, lastEventId });
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  fail(readyState = 0): void {
    this.readyState = readyState;
    this.onerror?.call(this as unknown as EventSource, new Event('error'));
  }

  listenerCount(): number {
    let total = 0;
    for (const listeners of this.listeners.values()) {
      total += listeners.size;
    }

    return total;
  }
}

export function eventData(
  type: RunEventType,
  runId: string,
  sequence: number,
  payload: object,
  occurredAt = '2026-11-03T10:00:00.000Z',
): string {
  return JSON.stringify({
    schemaVersion: 1,
    runId,
    sequence,
    occurredAt,
    type,
    payload,
  });
}
