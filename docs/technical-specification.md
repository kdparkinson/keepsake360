# Technical Specification

## 1. The tour format

A tour is a Marzipano export: a `data.js` that assigns the whole document to a
global, plus a tile pyramid.

```js
var APP_DATA = {
  name: 'Sample House 2026',
  scenes: [
    {
      id: 'living-room',
      name: 'Living Room',
      levels: [{ tileSize: 256, size: 4096 }],
      faceSize: 4096,
      initialViewParameters: { yaw: 1.2, pitch: -0.1, fov: 1.57 },
      linkHotspots: [{ yaw: 2.4, pitch: -0.3, rotation: 0.785, target: 'kitchen' }],
      infoHotspots: [{ yaw: 1.1, pitch: -0.4, title: '', text: 'Reading chair' }],
    },
  ],
  settings: { mouseViewMode: 'drag' },
};
```

- Tiles: `<tour>/tiles/<scene id>/<z>/<face>/<y>/<x>.jpg`.
- `linkHotspots[].rotation` is radians; `0` points the arrow straight up.
- `infoHotspots[].title` is carried but not displayed by this app; a note shows
  its `text`.

**Where the tour actually is.** Exports differ: the files sit at the folder root,
or the whole app is wrapped in `app-files/` with a stale, one-scene `data.js`
left at the top level. `findTourRoot` picks the folder that has both `data.js`
and `tiles/`, and the loader, the saver and the library's name lookup all use
that same folder. Reading the first `data.js` found is what once made the library
show an imported tour's name forever.

Saving regenerates the file exactly as `var APP_DATA = <json, 2-space>;`, so a
tour saved here is still the file the hosted editor and Marzipano's own tool
expect.

## 2. Stack

| Piece            | Choice                                                     |
| ---------------- | ---------------------------------------------------------- |
| Runtime          | Electron                                                   |
| Packaging        | Electron Forge + Vite (main, preload and renderer targets) |
| Panorama engine  | Marzipano                                                  |
| Archives         | `adm-zip`                                                  |
| Last-opened tour | `electron-store`                                           |
| Language         | TypeScript                                                 |

## 3. Storage

- **Library root:** `~/Documents/keepsake360` (`app.getPath('documents')`).
- One folder per tour, named from the archive (`my-house.zip` →
  `my-house/`), with `-2`, `-3` suffixes on collision.
- **Why Documents and not temp.** Edits are written back into the tour's own
  `data.js`. The OS reaps temp directories, which would silently revert them.
- **Saves are atomic:** write `data.js.tmp`, then rename over `data.js`. A crash
  mid-save cannot destroy the only copy.
- **Path containment:** the writer resolves the target and refuses anything that
  is not inside the tour folder. The IPC handler also refuses to save any tour
  other than the one that is open.

## 4. Serving a tour to the window

Tours live outside the app bundle, and the window is an `http://` page in
development, so `file://` URLs are not available. The main process registers a
privileged custom scheme, `keepsake-tour://`, and serves the currently open
tour's files from it:

- `keepsake-tour://tour/<path>` maps to `<tour folder>/<path>`.
- Requests are resolved and rejected if they escape the tour folder (403), and
  404 when nothing is open.
- A small MIME map covers `html`, `js`, `css`, `json`, images and fonts.
- Responses carry `Access-Control-Allow-Origin: *`, because Marzipano loads
  tiles as CORS images so they can become WebGL textures.

Privileges: `standard`, `secure`, `supportFetchAPI`, `corsEnabled`, `stream`.

## 5. Processes and IPC

The main process owns the filesystem, the dialogs and the remembered tour; the
renderer owns the UI. They meet only through `contextBridge` (`src/preload.ts`)
and these channels:

| Channel          | Purpose                                                        |
| ---------------- | -------------------------------------------------------------- |
| `tour:importZip` | Pick a `.zip`, copy it into the library, open it               |
| `tour:current`   | The tour to open on boot, or null                              |
| `tour:open`      | Open a library tour by folder (must be inside the library)     |
| `tour:list`      | Every library tour: folder, name, asset folder                 |
| `tour:save`      | Write the open tour's document back to its `data.js`           |
| `tour:export`    | Zip the open tour to a file the user picks                     |
| `tour:delete`    | Delete a library tour, after a native confirmation             |
| `tour:close`     | Forget the open tour, so the next launch starts at the library |

Typed results (`SaveResult`, `ExportResult`, `DeleteResult`, `TourImportResult`)
in `src/types.ts` keep both sides honest. A dismissed dialog is reported as
`{ ok: false, error: 'cancelled' }`, which the UI treats as "nothing happened"
rather than as a failure.

## 6. Editing pipeline

1. The engine mutates the live document in place (a hotspot's yaw, a note's text,
   the tour's name) and calls `onEdit(label)`.
2. The shell records a snapshot in the undo stack under that label, and schedules
   a save.
3. Saves are debounced (400 ms) and serialised through one promise chain, so two
   quick edits cannot land out of order.
4. Before leaving a tour — Exit, Export & exit, or opening another tour — the
   pending save is flushed.
5. A successful write only clears the "unsaved" flag if no edit happened while it
   was in flight; otherwise the exit flush would think there was nothing left to
   write and the last keystrokes would stay in memory.

**Undo** stores whole serialised documents: a `data.js` is a couple of kilobytes,
so copying it is cheaper to reason about than tracking which field changed, and
it cannot drift from what is on disk. Steps with the same label within 750 ms
coalesce (a burst of typing is one undo), the opened state is never merged into,
and the stack keeps 100 steps.

## 7. Export

Export zips the tour's library folder as-is into a file the user chooses,
defaulting to `<folder name>.zip` in Documents. No transformation: the result is
the same archive shape that was imported, so it re-imports here, opens in a
browser, and opens in the hosted editor.

## 8. Packaging and release

Electron Forge produces the installers; the GitHub Actions workflow in
`.github/workflows` builds and publishes them on a release. `npm start` runs the
Vite dev server plus Electron for development; main and preload changes need a
restart, renderer changes hot-reload.
