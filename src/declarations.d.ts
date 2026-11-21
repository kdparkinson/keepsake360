/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

import type { TourImportResult } from './types';

declare global {
  interface Window {
    /** The secure bridge to the main process, exposed by the preload script. */
    keepsake: {
      importFolder: () => Promise<TourImportResult>;
      importZip: () => Promise<TourImportResult>;
    };
  }
}
