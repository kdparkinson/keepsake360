import AdmZip from 'adm-zip';
import { app } from 'electron';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/**
 * Find the directory that contains a Marzipano tour (a `data.js` file).
 *
 * Handles both layouts: the tour files sit directly in the folder, OR the
 * folder wraps the tour in a single top-level subfolder (common in ZIPs).
 * Returns the absolute path to the directory, or null if none is found.
 */
export function findTourDirectory(dir: string): string | null {
  const rootData = path.join(dir, 'data.js');
  if (existsSync(rootData)) {
    return dir;
  }

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nestedData = path.join(dir, entry.name, 'data.js');
    if (existsSync(nestedData)) {
      return path.join(dir, entry.name);
    }
  }

  return null;
}

/**
 * Find the folder that holds a tour's `data.js` *and* its `tiles/`, relative
 * to the tour directory, or null if no such pair exists.
 *
 * Marzipano exports usually put both straight in the tour folder (''), but
 * larger exports wrap the app in a subfolder and leave a stale one-scene
 * `data.js` at the top level — the real data lives in `app-files/data.js`
 * beside `app-files/tiles/`. The viewer builds its own asset URLs, so it has
 * to load the `data.js` that matches the tiles rather than the first one found.
 */
export function findTourRoot(tourDir: string): string | null {
  const holdsTour = (dir: string) =>
    existsSync(path.join(dir, 'data.js')) && existsSync(path.join(dir, 'tiles'));

  if (holdsTour(tourDir)) {
    return '';
  }

  for (const entry of readdirSync(tourDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (holdsTour(path.join(tourDir, entry.name))) {
      return entry.name;
    }
  }

  return null;
}

/**
 * Extract a `.zip` archive into a fresh, unique temporary directory and
 * return the absolute path to that directory.
 *
 * adm-zip refuses to extract entries that escape the target path, so this is
 * safe against "zip-slip" path-traversal archives.
 */
export function extractZipToTemp(zipPath: string): string {
  const targetDir = path.join(app.getPath('temp'), 'keepsake360', randomUUID());
  mkdirSync(targetDir, { recursive: true });
  // `overwrite = true` so a (very unlikely) reused id can't half-extract.
  new AdmZip(zipPath).extractAllTo(targetDir, true);
  return targetDir;
}
