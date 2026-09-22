/**
 * A status line that clears itself. Each flasher owns one timer, and a new message cancels the
 * previous message's timer; with a timer per message, the older message's timeout blanks the
 * newer one before its time is up.
 */
export function createFlash(show: (msg: string) => void, defaultMs: number): (msg: string, ms?: number) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (msg, ms = defaultMs) => {
    show(msg);
    clearTimeout(timer);
    timer = setTimeout(() => show(""), ms);
  };
}
