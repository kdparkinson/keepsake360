// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type {
  DeleteResult,
  ExportResult,
  LoadedTour,
  SaveResult,
  TourImportResult,
  TourSummary,
} from './types';
import type { TourAppData } from './tour/types';

// The minimal API the "Window" (renderer) is allowed to use to talk to the
// "Brain" (main process). Everything the renderer can do is listed here.
const keepsake = {
  /**
   * Ask the main process to open a `.zip` picker, copy the chosen archive into
   * the tour library, and open the tour found inside. On success the tour is
   * also pushed to the renderer through `onTour`. Returns the outcome so the
   * landing screen can react (e.g. show an error message).
   */
  importZip: (): Promise<TourImportResult> => ipcRenderer.invoke('tour:importZip'),

  /** The tour the main process currently has open, or null for the landing page. */
  getTour: (): Promise<LoadedTour | null> => ipcRenderer.invoke('tour:current'),

  /** Every tour in the library, for the landing screen. */
  listTours: (): Promise<TourSummary[]> => ipcRenderer.invoke('tour:list'),

  /** Open a tour that is already in the library. */
  openTour: (directory: string): Promise<TourImportResult> =>
    ipcRenderer.invoke('tour:open', directory),

  /** Zip the open tour to a file the user picks. */
  exportTour: (): Promise<ExportResult> => ipcRenderer.invoke('tour:export'),

  /**
   * Delete a tour from the library. The main process asks for confirmation and
   * refuses to delete the tour that is currently open.
   */
  deleteTour: (directory: string): Promise<DeleteResult> =>
    ipcRenderer.invoke('tour:delete', directory),

  /** Forget the open tour, so the next launch starts on the landing page. */
  closeTour: (): Promise<void> => ipcRenderer.invoke('tour:close'),

  /**
   * Write the tour's data back to its own `data.js`. Only the tour that is
   * open can be saved; the main process checks that.
   */
  saveTour: (directory: string, assets: string, data: TourAppData): Promise<SaveResult> =>
    ipcRenderer.invoke('tour:save', directory, assets, data),

  /**
   * Be told when the main process opens a tour (an import from the native
   * menu, say). Returns a function that unsubscribes.
   */
  onTour: (callback: (tour: LoadedTour) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, tour: LoadedTour) => callback(tour);
    ipcRenderer.on('tour:load', listener);
    return () => {
      ipcRenderer.off('tour:load', listener);
    };
  },
};

// Expose the API as `window.keepsake` in the renderer.
contextBridge.exposeInMainWorld('keepsake', keepsake);
