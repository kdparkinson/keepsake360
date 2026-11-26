import type { TourAppData } from './types';

/**
 * Loads a tour's `data.js`, which Marzipano exports as a script that assigns
 * `var APP_DATA = {...}`. The tour's files are served by the main process over
 * this scheme, so they can be read from wherever the tour lives — a folder in
 * the tour library, outside the app bundle.
 */
const TOUR_ORIGIN = 'keepsake-tour://tour';

declare global {
  interface Window {
    /** Populated by the tour's `data.js`, which we inject as a script. */
    APP_DATA?: TourAppData;
  }
}

/**
 * The URL the engine builds tile and data URLs from, given the asset folder the
 * main process worked out ('' for a tour whose files sit at the root).
 */
export function assetBaseFor(assets: string): string {
  const root = assets.replace(/^\/+|\/+$/g, '');
  return root ? `${TOUR_ORIGIN}/${encodeURI(root)}` : TOUR_ORIGIN;
}

/** Inject the tour's `data.js` and resolve with the data it defines. */
export function loadTourData(assetBase: string): Promise<TourAppData> {
  return new Promise((resolve, reject) => {
    // A previous tour's data must not satisfy this load if this one fails.
    window.APP_DATA = undefined;

    const script = document.createElement('script');
    // A timestamp avoids a stale cached data.js when switching tours quickly.
    script.src = `${assetBase}/data.js?t=${Date.now()}`;

    const cleanup = () => script.remove();

    script.onload = () => {
      cleanup();
      if (window.APP_DATA) {
        resolve(window.APP_DATA);
      } else {
        reject(new Error('data.js did not define APP_DATA.'));
      }
    };

    script.onerror = () => {
      cleanup();
      reject(new Error('data.js could not be read.'));
    };

    document.head.append(script);
  });
}
