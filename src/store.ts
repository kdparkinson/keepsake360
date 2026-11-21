import Store from 'electron-store';

/**
 * The "Brain's Memory": a single JSON file (in the OS user-data dir) that
 * remembers the most recently used tour. Isolated behind this module so the
 * storage backend can be swapped without touching the rest of the app.
 */
const store = new Store<{
  /** Absolute path to the folder containing the last tour's index.html, or null. */
  lastTour: string | null;
}>({
  defaults: {
    lastTour: null,
  },
});

/** The path to the most recently used tour's `index.html`, or null if none. */
export function getLastTour(): string | null {
  return store.get('lastTour', null);
}

/** Remember a tour so it can auto-launch on the next start. */
export function rememberTour(indexHtmlPath: string): void {
  store.set('lastTour', indexHtmlPath);
}

/** Forget the remembered tour (e.g. after it no longer exists on disk). */
export function forgetTour(): void {
  store.set('lastTour', null);
}
