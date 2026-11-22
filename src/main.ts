import { app, BrowserWindow, dialog, ipcMain, Menu, protocol } from 'electron';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import type { TourImportResult } from './types';
import { forgetTour, getLastTour, rememberTour } from './store';
import { extractZipToTemp, findTourDirectory, findTourRoot } from './file-manager';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Kept at module scope so the IPC handlers can reach the live window.
let mainWindow: BrowserWindow | null = null;

// Tours live outside the app bundle (a chosen folder, or a ZIP extracted to a
// temp directory), so they are served to the viewer over this custom scheme
// instead of file:// (which the dev server's http:// page cannot load).
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
// its files (data.js, tiles, …).
let currentTourDir: string | null = null;

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

/** The URL of the viewer page in whichever mode we are running. */
function viewerUrl(): string {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    // In development the renderer is served by Vite, which also serves viewer.html.
    return new URL('viewer.html', MAIN_WINDOW_VITE_DEV_SERVER_URL).href;
  }

  // Packaged builds emit viewer.html beside index.html in the renderer output.
  return pathToFileURL(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/viewer.html`))
    .href;
}

/** Load a tour's directory into the universal viewer. */
function loadTour(pathOrFile: string): void {
  if (!mainWindow) return;

  // If the path provided is a file (like an old index.html), get its parent directory.
  let dir = pathOrFile;
  if (pathOrFile.endsWith('index.html')) {
    dir = path.dirname(pathOrFile);
  }

  currentTourDir = dir;

  // Exports differ in where the tour's assets sit (`data.js` + `tiles/` at the
  // top, or wrapped in `app-files/`), so tell the viewer which folder to use.
  const assetRoot = findTourRoot(dir) ?? '';

  // Construct the URL for the universal viewer with the directory as a parameter.
  const url = new URL(viewerUrl());
  url.searchParams.set('dir', dir);
  url.searchParams.set('assets', assetRoot);

  mainWindow.loadURL(url.href);
}

/**
 * Decide what to show first: if we remember a tour that still exists on disk,
 * auto-launch it; otherwise show the "Import Your Home" landing page.
 */
function loadInitialContent(): void {
  const stored = getLastTour();

  if (stored && existsSync(stored)) {
    loadTour(stored);
    return;
  }

  // A remembered path that no longer exists means the tour was moved/deleted —
  // forget it so we stop failing on it, then fall through to the landing page.
  if (stored) {
    forgetTour();
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow?.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    // Open the DevTools only while running against the dev server.
    mainWindow?.webContents.openDevTools();
  } else {
    mainWindow?.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
}

/** Ask the user to pick a folder that contains a tour, then load it. */
async function importFromFolder(): Promise<TourImportResult> {
  if (!mainWindow) {
    return { ok: false, error: 'The application window is not ready yet.' };
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Your Home',
    properties: ['openDirectory'],
  });

  // The user dismissed the dialog — not an error, just a no-op.
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, error: 'cancelled' };
  }

  const folder = result.filePaths[0];
  const directory = findTourDirectory(folder);
  if (!directory) {
    return {
      ok: false,
      error: 'We couldn’t find a tour in that folder — no “data.js” was found. Please try again.',
    };
  }

  // The "switch": remember this tour and load it, replacing the landing page.
  rememberTour(directory);
  loadTour(directory);
  return { ok: true, directory };
}

/** Ask the user to pick a `.zip` archive, extract it, and load its tour. */
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

  // Extract to a temp dir and locate the tour. A malformed archive throws —
  // treat that as "no tour found" rather than crashing the app.
  let directory: string | null;
  try {
    const dir = extractZipToTemp(zipPath);
    directory = findTourDirectory(dir);
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

  rememberTour(directory);
  loadTour(directory);
  return { ok: true, directory };
}

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    // Frameless keeps the viewer immersive and free of browser distractions.
    frame: false,
    width: 1280,
    height: 800,
    // Avoid the white flash a frameless window shows before content loads.
    show: false,
    backgroundColor: '#111',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  loadInitialContent();
};

// A minimal native menu keeps the app usable while the window is frameless:
// it's the way to import a tour or quit. (A nicer in-window overlay is
// planned for a later phase.)
const buildMenu = () => {
  const template = [
    {
      label: 'keepsake360',
      submenu: [
        { label: 'Import Tour…', click: () => void importFromFolder() },
        { label: 'Import ZIP…', click: () => void importFromZip() },
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
  ipcMain.handle('import:openFolder', () => importFromFolder());
  ipcMain.handle('import:openZip', () => importFromZip());

  registerTourProtocol();
  buildMenu();
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

// In this file you can include the rest of your app's specific main process
// code. You can also put additional code in separate files and import it here.
