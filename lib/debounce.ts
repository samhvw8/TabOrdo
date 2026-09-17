/**
 * One pending call at a time: scheduling replaces whatever was waiting, and `flush` runs it
 * now instead of when the timer fires.
 *
 * The popup's lookups against bookmarks and history wait for typing to settle, but Enter can't
 * wait with them: a fast "/b react" + Enter would otherwise act on the list from before the
 * lookup ran, or on no list at all. So flush also waits out a lookup already in flight.
 */
export interface Debouncer {
  schedule(fn: () => unknown): void;
  cancel(): void;
  /** Run the pending call now, or wait for the one already running; resolves when it settles. */
  flush(): Promise<void>;
  readonly pending: boolean;
}

export function createDebouncer(ms: number): Debouncer {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiting: (() => unknown) | undefined;
  let running: Promise<unknown> | undefined;

  function run(): Promise<unknown> {
    const fn = waiting!;
    waiting = undefined;
    clearTimeout(timer);
    const p = (async () => fn())();
    running = p;
    const settle = () => { if (running === p) running = undefined; };
    p.then(settle, settle);
    return p;
  }

  return {
    schedule(fn) {
      waiting = fn;
      clearTimeout(timer);
      timer = setTimeout(run, ms);
    },
    cancel() {
      waiting = undefined;
      clearTimeout(timer);
    },
    async flush() {
      if (waiting) await run();
      else if (running) await running;
    },
    get pending() {
      return waiting !== undefined;
    },
  };
}
