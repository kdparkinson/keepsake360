/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

import type {
  DeleteResult,
  ExportResult,
  LoadedTour,
  SaveResult,
  TourImportResult,
  TourSummary,
} from './types';
import type { TourAppData } from './tour/types';

declare global {
  interface Window {
    /** The secure bridge to the main process, exposed by the preload script. */
    keepsake: {
      importZip: () => Promise<TourImportResult>;
      getTour: () => Promise<LoadedTour | null>;
      listTours: () => Promise<TourSummary[]>;
      openTour: (directory: string) => Promise<TourImportResult>;
      exportTour: () => Promise<ExportResult>;
      deleteTour: (directory: string) => Promise<DeleteResult>;
      closeTour: () => Promise<void>;
      saveTour: (directory: string, assets: string, data: TourAppData) => Promise<SaveResult>;
      onTour: (callback: (tour: LoadedTour) => void) => () => void;
    };
  }
}
