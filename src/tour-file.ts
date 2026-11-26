import { rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TourAppData } from './tour/types';

/**
 * Reading and writing a tour's `data.js`.
 *
 * Marzipano's own tool writes `var APP_DATA = {...}` into `data.js` and reads
 * it back from the global, so saving means regenerating that script in place.
 * The tour's `index.html` refers to the same global, which keeps a saved tour
 * openable in a browser exactly as it was before editing.
 */

/** The `data.js` path for a tour: `<directory>/<assets>/data.js`. */
export function tourDataFile(directory: string, assets: string): string {
  return path.join(directory, assets, 'data.js');
}

/** Serialise a tour the way Marzipano's tool does. */
export function serializeTour(data: TourAppData): string {
  return `var APP_DATA = ${JSON.stringify(data, null, 2)};\n`;
}

/**
 * Write a tour's data back to disk.
 *
 * The file is written beside the target and renamed over it, so an
 * interrupted save cannot leave a half-written `data.js` that the tour would
 * fail to load.
 */
export async function writeTourData(
  directory: string,
  assets: string,
  data: TourAppData,
): Promise<void> {
  const target = path.resolve(tourDataFile(directory, assets));
  const root = path.resolve(directory);

  // The paths come from this app, not from a tour file, but a save must never
  // be the thing that writes outside the tour folder.
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('That tour path is outside its folder.');
  }

  const temporary = `${target}.tmp`;

  await writeFile(temporary, serializeTour(data), 'utf8');

  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
