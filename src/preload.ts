// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';
import type { TourImportResult } from './types';

// The minimal API the "Window" (renderer) is allowed to use to talk to the
// "Brain" (main process). Everything the renderer can do is listed here.
const keepsake = {
  /**
   * Ask the main process to open a folder picker and load the chosen tour.
   * The main process performs the dialog, validates the folder, and — on
   * success — switches the window to the tour. Returns the outcome so the
   * renderer can react (e.g. show an error message).
   */
  importFolder: (): Promise<TourImportResult> => ipcRenderer.invoke('import:openFolder'),

  /**
   * Same as `importFolder`, but picks a `.zip` archive, extracts it to a temp
   * directory, and loads the tour found inside.
   */
  importZip: (): Promise<TourImportResult> => ipcRenderer.invoke('import:openZip'),
};

// Expose the API as `window.keepsake` in the renderer.
contextBridge.exposeInMainWorld('keepsake', keepsake);
