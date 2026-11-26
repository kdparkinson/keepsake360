import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } from 'electron';
import AdmZip from 'adm-zip';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import started from 'electron-squirrel-startup';
import type {
  DeleteResult,
  ExportResult,
  LoadedTour,
  SaveResult,
  TourImportResult,
  TourSummary,
} from './types';
import type { TourAppData } from './tour/types';
import { forgetTour, getLastTour, rememberTour } from './store';
import { findTourDirectory, findTourRoot } from './file-manager';
import { importZipToLibrary, libraryRoot, listTours as listLibraryTours } from './library';
import { writeTourData } from './tour-file';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Kept at module scope so the IPC handlers can reach the live window.
let mainWindow: BrowserWindow | null = null;

// Tours live outside the app bundle (a folder in the tour library), so they are
// served to the renderer over this custom scheme instead of file:// (which the
// dev server's http:// page cannot load).
const TOUR_SCHEME = 'keepsake-tour';

// Tour assets are plain files, so map the extensions a Marzipano export uses.
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: TOUR_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// The directory of the tour currently on screen; the protocol handler serves
// its files (data.js, tiles, …) and a save writes back into it.
let currentTourDir: string | null = null;

// The tour the renderer should open, in the shape the viewer needs. Null means
// the window shows its landing screen.
let currentTour: LoadedTour | null = null;

/** Serve the current tour's files over the `keepsake-tour://` scheme. */
function registerTourProtocol(): void {
  protocol.handle(TOUR_SCHEME, async (request) => {
    if (!currentTourDir) {
      return new Response('No tour is loaded.', { status: 404 });
    }

    // `keepsake-tour://tour/tiles/scene/...` -> `<tourDir>/tiles/scene/...`
    let filePath: string;
    try {
      const requestedPath = decodeURIComponent(new URL(request.url).pathname);
      filePath = path.join(currentTourDir, requestedPath);
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    // Never let a request climb out of the tour directory.
    if (filePath !== currentTourDir && !filePath.startsWith(currentTourDir + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const bytes = new Uint8Array(await readFile(filePath));
      return new Response(bytes.buffer as ArrayBuffer, {
        headers: {
          'Content-Type':
            MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
          // Marzipano loads tiles as CORS images so they can be WebGL textures.
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

/** Describe a tour folder the way the renderer expects it. */
function tourPayload(dir: string): LoadedTour {
  // Exports differ in where the tour's assets sit (`data.js` + `tiles/` at the
  // top, or wrapped in `app-files/`), so work out which folder to load from.
  const root = findTourRoot(dir);
  if (root !== null) {
    return { directory: dir, assets: root };
  }

  // A tour whose `tiles/` are missing still has to have its `data.js` saved
  // back where it actually lives, rather than beside it.
  const dataDir = findTourDirectory(dir);
  const assets = dataDir ? path.relative(dir, dataDir).split(path.sep).join('/') : '';
  return { directory: dir, assets };
}

/**
 * Open a tour. The window is not navigated — it already holds the landing,
 * view and edit states — so this only hands the renderer a new tour, which
 * replaces whatever was on screen without a page load.
 */
function openTour(dir: string): LoadedTour {
  currentTourDir = dir;
  currentTour = tourPayload(dir);
  rememberTour(dir);
  mainWindow?.webContents.send('tour:load', currentTour);
  return currentTour;
}

/** Drop the open tour so the window returns to its landing screen. */
function closeTour(): void {
  currentTourDir = null;
  currentTour = null;
  // Also forget it, so the next launch does not silently reopen what was
  // closed.
  forgetTour();
}

/**
 * On launch, remember the last tour if it is still on disk. The renderer pulls
 * it with `tour:current` once its own scripts are running.
 */
function restoreLastTour(): void {
  const stored = getLastTour();

  // Tours imported before the library existed were extracted into the OS temp
  // directory, where an edit cannot survive. Treat those as gone rather than
  // letting someone edit a folder that is about to be reaped.
  const usable = stored && existsSync(stored) && !stored.startsWith(app.getPath('temp') + path.sep);

  if (stored && usable) {
    currentTourDir = stored;
    currentTour = tourPayload(stored);
    return;
  }

  // A remembered path that no longer exists means the tour was moved/deleted —
  // forget it so we stop failing on it, then show the landing page.
  if (stored) {
    forgetTour();
  }
}

/**
 * Write the open tour's data back to its `data.js`.
 *
 * Only the tour that is actually open may be saved, so a renderer mistake
 * cannot overwrite some other folder.
 */
async function saveTour(directory: string, assets: string, data: TourAppData): Promise<SaveResult> {
  if (!currentTour || directory !== currentTour.directory) {
    return { ok: false, error: 'That tour is not open any more.' };
  }

  if (!data || !Array.isArray(data.scenes)) {
    return { ok: false, error: 'There was nothing to save.' };
  }

  try {
    await writeTourData(directory, assets, data);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** The tours in the library, as the landing screen lists them. */
function listTours(): TourSummary[] {
  return listLibraryTours().map((entry) => ({
    ...tourPayload(entry.directory),
    name: entry.name,
    folder: entry.folder,
  }));
}

/**
 * Open a tour that is already in the library.
 *
 * Only folders inside the library are accepted, so the renderer cannot ask the
 * main process to open — and then save edits into — any folder on the disk.
 */
function openLibraryTour(directory: string): TourImportResult {
  const root = path.resolve(libraryRoot());
  const requested = path.resolve(directory);

  if (requested !== root && !requested.startsWith(root + path.sep)) {
    return { ok: false, error: 'That folder is not in your tour library.' };
  }

  const tourDir = findTourDirectory(requested);
  if (!tourDir) {
    return { ok: false, error: 'That tour could not be found any more.' };
  }

  return { ok: true, tour: openTour(tourDir) };
}

/**
 * Delete a tour from the library, after asking.
 *
 * The whole library folder goes, not just the directory holding `data.js`:
 * an archive that wrapped its files in a subfolder would otherwise leave that
 * wrapper behind as an empty, unopenable entry.
 */
async function deleteLibraryTour(directory: string): Promise<DeleteResult> {
  if (!mainWindow) {
    return { ok: false, error: 'The application window is not ready yet.' };
  }

  const root = path.resolve(libraryRoot());
  const requested = path.resolve(directory);

  if (requested === root || !requested.startsWith(root + path.sep)) {
    return { ok: false, error: 'That folder is not in your tour library.' };
  }

  if (currentTourDir && path.resolve(currentTourDir) === requested) {
    return { ok: false, error: 'That tour is open — exit it before deleting it.' };
  }

  const folder = path.join(root, path.relative(root, requested).split(path.sep)[0]);

  const answer = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Delete'],
    defaultId: 0,
    cancelId: 0,
    message: `Delete “${path.basename(folder)}”?`,
    detail: `This removes the tour folder and its tiles from your library.\n\n${folder}\n\nIt cannot be undone.`,
  });

  if (answer.response !== 1) {
    return { ok: false, error: 'cancelled' };
  }

  try {
    await rm(folder, { recursive: true, force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/**
 * Zip the open tour into a single archive the user picks a place for.
 *
 * The tour folder is archived as-is, so the result is an ordinary Marzipano
 * tour archive: it imports back into this app, and opens in a browser or any
 * Marzipano viewer without this app at all.
 */
async function exportOpenTour(): Promise<ExportResult> {
  if (!mainWindow || !currentTourDir) {
    return { ok: false, error: 'No tour is open.' };
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export tour',
    defaultPath: path.join(app.getPath('documents'), `${path.basename(currentTourDir)}.zip`),
    filters: [{ name: 'Tour archive', extensions: ['zip'] }],
  });

  if (result.canceled || !result.filePath) {
    return { ok: false, error: 'cancelled' };
  }

  try {
    const archive = new AdmZip();
    archive.addLocalFolder(currentTourDir);
    await writeFile(result.filePath, archive.toBuffer());
    return { ok: true, path: result.filePath };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** Ask the user to pick a `.zip` archive, copy it into the library, and open it. */
async function importFromZip(): Promise<TourImportResult> {
  if (!mainWindow) {
    return { ok: false, error: 'The application window is not ready yet.' };
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import a ZIP',
    properties: ['openFile'],
    filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, error: 'cancelled' };
  }

  const zipPath = result.filePaths[0];

  // A malformed archive throws — treat that as "no tour found" rather than
  // crashing the app. Either way the library folder is cleaned up for us.
  let directory: string | null;
  try {
    directory = importZipToLibrary(zipPath);
  } catch {
    directory = null;
  }

  if (!directory) {
    return {
      ok: false,
      error:
        'That ZIP did not contain a tour — no “data.js” was found inside. Please try a different archive.',
    };
  }

  return { ok: true, tour: openTour(directory) };
}

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    // A standard frame, so the window gets native title-bar dragging and window
    // buttons on both platforms, and Windows renders the app menu bar — which
    // holds the only way to import another ZIP once a tour is on screen.
    frame: true,
    width: 1280,
    height: 800,
    // Avoid the white flash a window shows before its content loads.
    show: false,
    backgroundColor: '#111',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    // Open the DevTools only while running against the dev server.
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
};

// A minimal native menu is the way to import a ZIP, reveal the tour in Finder,
// or quit: macOS puts it in the system menu bar, and Windows draws it under the
// title bar.
const buildMenu = () => {
  const template = [
    {
      label: 'keepsake360',
      submenu: [
        { label: 'Import ZIP…', click: () => void importFromZip() },
        {
          label: 'Show Tour Folder',
          click: () => {
            if (currentTourDir) void shell.openPath(currentTourDir);
          },
        },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

// This method will be called after Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  // Wire up the context bridge channels the renderer calls.
  ipcMain.handle('tour:importZip', () => importFromZip());
  ipcMain.handle('tour:current', () => currentTour);
  ipcMain.handle('tour:close', () => closeTour());
  ipcMain.handle('tour:list', () => listTours());
  ipcMain.handle('tour:open', (_event, directory: string) => openLibraryTour(directory));
  ipcMain.handle('tour:export', () => exportOpenTour());
  ipcMain.handle('tour:delete', (_event, directory: string) => deleteLibraryTour(directory));
  ipcMain.handle('tour:save', (_event, directory: string, assets: string, data: TourAppData) =>
    saveTour(directory, assets, data),
  );

  registerTourProtocol();
  buildMenu();
  restoreLastTour();
  createWindow();
});

// Quit when all windows are closed, except on macOS. There, it's common
// to re-create a window in the app when the
// dock icon is clicked and there are no other windows open.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Quit when all windows are closed, except on macOS. There, it's common
// to re-create a window in the app when the
// dock icon is clicked and there are no other windows open.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
