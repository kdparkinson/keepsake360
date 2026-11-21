/**
 * Shared between the main and renderer processes so the two sides of the
 * context bridge agree on the shape of an import attempt.
 */
export type TourImportResult = { ok: true; directory: string } | { ok: false; error: string };
