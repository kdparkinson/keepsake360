import type { TourAppData, TourScene, TourViewParameters } from './types';

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

/**
 * The level a room's square preview comes from.
 *
 * A level marked `fallbackOnly` is a low-resolution stand-in that has no tiles
 * on disk, and `{z}` in a tile URL is the level's index in the whole list — so
 * the first level that actually has tiles is often 1, not 0.
 */
export function firstTileLevel(levels: TourScene['levels']): number | null {
  const index = levels.findIndex((level) => !level.fallbackOnly);
  return index === -1 ? null : index;
}

/** The cube face whose centre the camera looks closest to when the room opens. */
function openingFace(view: TourViewParameters): string {
  const yaw = view.yaw ?? 0;
  const pitch = view.pitch ?? 0;

  // The camera's forward vector, from the same maths Marzipano's rectilinear
  // view uses: the front face looks down -z, `l` and `r` across, `u` and `d` up
  // and down. Picking the face with the largest dot product therefore picks the
  // face the room opens looking into, without any guess about sign conventions.
  const x = Math.sin(yaw) * Math.cos(pitch);
  const y = Math.sin(pitch);
  const z = -Math.cos(yaw) * Math.cos(pitch);
  const dot = (nx: number, ny: number, nz: number) => nx * x + ny * y + nz * z;

  let best = 'f';
  let bestDot = dot(0, 0, -1);

  for (const [face, nx, ny, nz] of [
    ['b', 0, 0, 1],
    ['l', -1, 0, 0],
    ['r', 1, 0, 0],
    ['u', 0, 1, 0],
    ['d', 0, -1, 0],
  ] as const) {
    const value = dot(nx, ny, nz);
    if (value > bestDot) {
      best = face;
      bestDot = value;
    }
  }

  return best;
}

/**
 * A square preview of a room's starting view, or null when the tour ships no
 * tiles to draw one from.
 *
 * One tile of the cube face the room opens looking at, at the smallest level:
 * a few kilobytes rather than a second pyramid.
 */
export function sceneThumbnailUrl(assetBase: string, scene: TourScene): string | null {
  const level = firstTileLevel(scene.levels ?? []);
  if (level === null) return null;

  const face = openingFace(scene.initialViewParameters ?? { pitch: 0, yaw: 0, fov: 0 });
  return `${assetBase}/tiles/${encodeURIComponent(scene.id)}/${level}/${face}/0/0.jpg`;
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
