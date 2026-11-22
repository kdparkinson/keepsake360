// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';
import type { TourImportResult } from './types';

// The minimal API the "Window" (renderer) is allowed to use to talk to the
// "Brain" (main process). Everything the renderer can do is listed here.
const keepsake = {
  /**
   * Ask the main process to open a `.zip` picker, extract the chosen archive to
   * a temporary directory, and load the tour found inside. The main process
   * performs the dialog, validates the archive, and — on success — switches the
   * window to the tour. Returns the outcome so the renderer can react (e.g.
   * show an error message).
   */
  importZip: (): Promise<TourImportResult> => ipcRenderer.invoke('import:openZip'),
};

// Expose the API as `window.keepsake` in the renderer.
contextBridge.exposeInMainWorld('keepsake', keepsake);
