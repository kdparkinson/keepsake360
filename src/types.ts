/**
 * Shared between the main and renderer processes so the two sides of the
 * context bridge agree on the shape of a tour and of an import attempt.
 */

/** A tour the window can open, described the way the viewer needs it. */
export interface LoadedTour {
  /** Absolute path to the folder holding the tour's `data.js`. */
  directory: string;
  /**
   * Folder inside `directory` that holds `data.js` and `tiles/`, or '' when
   * both sit at the top (larger exports wrap them in `app-files/`).
   */
  assets: string;
}

/** A tour in the library, as the landing screen lists it. */
export interface TourSummary extends LoadedTour {
  /** The tour's own name, from its `data.js`. Exports often all say "Untitled Project". */
  name: string;
  /** The library folder it lives in, which is unique. */
  folder: string;
}

export type TourImportResult = { ok: true; tour: LoadedTour } | { ok: false; error: string };

export type SaveResult = { ok: true } | { ok: false; error: string };

export type ExportResult = { ok: true; path: string } | { ok: false; error: string };

export type DeleteResult = { ok: true } | { ok: false; error: string };
