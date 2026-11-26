import { app } from 'electron';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { extractZipTo, findTourDirectory, findTourRoot } from './file-manager';

/**
 * The tour library: one folder per imported tour, inside the user's Documents.
 *
 * Tours live here rather than in a temp directory because edits are written
 * back into the tour's own `data.js`. The OS reaps temp directories, which
 * would take the edits with them, and the tour would silently revert.
 */
export function libraryRoot(): string {
  return path.join(app.getPath('documents'), 'keepsake360');
}

/** A folder name under `root` that is not taken yet (`home`, `home-2`, …). */
function freeFolder(root: string, base: string): string {
  let candidate = path.join(root, base);

  for (let suffix = 2; existsSync(candidate); suffix++) {
    candidate = path.join(root, `${base}-${suffix}`);
  }

  return candidate;
}

/** A filesystem-friendly folder name derived from the archive's name. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'tour';
}

/**
 * Copy a tour archive into the library and return the folder that holds its
 * `data.js`, or null when the archive contains no tour.
 *
 * The folder is removed again if the archive turns out to hold nothing usable,
 * so a failed import leaves no debris behind.
 */
export function importZipToLibrary(zipPath: string): string | null {
  const root = libraryRoot();
  mkdirSync(root, { recursive: true });

  const destination = freeFolder(root, slugify(path.basename(zipPath, path.extname(zipPath))));

  try {
    extractZipTo(zipPath, destination);
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    throw error;
  }

  const tourDir = findTourDirectory(destination);
  if (!tourDir) {
    rmSync(destination, { recursive: true, force: true });
    return null;
  }

  return tourDir;
}

/**
 * The `data.js` a tour is actually loaded from.
 *
 * Bigger exports wrap the app in `app-files/` and leave a stale one-scene
 * `data.js` at the top level. The viewer loads the one beside `tiles/`, so the
 * name has to be read from the same file, or the library keeps showing the
 * name the archive was imported with — long after the tour has been renamed.
 */
function tourDataDirectory(tourDir: string): string {
  const assets = findTourRoot(tourDir);
  return assets === null ? tourDir : path.join(tourDir, assets);
}

/** The tour's own display name, read from the `name` field of its `data.js`. */
function readTourName(tourDir: string): string | null {
  try {
    const text = readFileSync(path.join(tourDir, 'data.js'), 'utf8');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;

    // Parsed rather than pattern-matched: the first `"name"` is the tour's, but
    // a name containing a quote or an escape would come back cut in half.
    const data = JSON.parse(text.slice(start, end + 1)) as { name?: unknown };
    return typeof data.name === 'string' ? data.name : null;
  } catch {
    return null;
  }
}

/**
 * Every tour in the library, newest folder name last, as the landing screen
 * shows them. Folders without a tour in them are ignored rather than listed as
 * broken entries.
 */
export function listTours(): { directory: string; name: string; folder: string }[] {
  const root = libraryRoot();
  if (!existsSync(root)) return [];

  const tours: { directory: string; name: string; folder: string }[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const tourDir = findTourDirectory(path.join(root, entry.name));
    if (!tourDir) continue;

    tours.push({
      directory: tourDir,
      name: readTourName(tourDataDirectory(tourDir)) ?? entry.name,
      folder: entry.name,
    });
  }

  return tours.sort((a, b) => a.folder.localeCompare(b.folder));
}
