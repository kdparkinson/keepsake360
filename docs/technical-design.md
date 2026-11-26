# Technical Design

## 1. Three processes, one job each

- **Main** (`src/main.ts`) — the window, the filesystem, the native dialogs, the
  remembered tour, the `keepsake-tour://` protocol, and the IPC handlers.
- **Preload** (`src/preload.ts`) — nothing but the `contextBridge` surface
  declared in `src/declarations.d.ts`. The renderer has no Node access.
- **Renderer** (`src/renderer.ts`) — the whole UI, and the tour engine.

The split is deliberately narrow: the renderer never touches a path, and the
main process never draws anything.

## 2. One page, three states

The window is loaded once. Landing, viewing and editing are states of
`#app[data-state]`, not pages:

```
landing  ──import/open──▶  view  ──Edit──▶  edit
   ▲                        │  ◀──View──     │
   └────────── Exit / Export & exit ─────────┘
```

Nothing navigates after boot. That is what lets the View/Edit switch keep the
camera exactly where it was: switching modes changes how the engine treats
pointer events, not the scene it is showing. A page load would rebuild the
viewer and lose the position — the reason the editor was folded into the app
rather than bolted on as a second page.

## 3. Module map

```
src/
├── main.ts              window, protocol, IPC, import/export/delete
├── preload.ts           contextBridge surface
├── declarations.d.ts    the typed window.keepsake bridge
├── marzipano.d.ts       ambient types for the Marzipano ESM build
├── css.d.ts             ambient type for CSS imports
├── types.ts             LoadedTour, TourSummary, result types (shared)
├── store.ts             electron-store: the last opened tour
├── library.ts           library root, ZIP → folder, listTours (+ names)
├── library-view.ts      the landing screen's list rows
├── file-manager.ts      find the tour inside an extracted archive
├── tour-file.ts         read/write a tour's data.js (atomic write)
├── history.ts           the snapshot undo stack
├── renderer.ts          the shell: state, selection, saving, library, export
├── index.css            chrome, markers, popup, dial, library
└── tour/
    ├── engine.ts        Marzipano viewer, scenes, markers, editing
    ├── data.ts          load data.js over keepsake-tour://
    └── types.ts         the tour document shape
```

The renderer is the only module that knows about all of these at once — which
tour is open, what is selected, when to write — so the two pieces that do not
need that knowledge live outside it: the undo stack deals in strings, and the
library view draws rows and reports clicks.

## 4. The tour engine

`createTourEngine(element, data, assetBase, { mode, editor, onSelectionChange, onEdit })`.

- **Scenes are built once per tour.** Each scene has its own
  `RectilinearView` with the tour's initial parameters and the usual rectilinear
  limits.
- **Markers are buttons.** A link marker is a circle holding an inner span whose
  transform carries the hotspot's `rotation` (Marzipano owns the marker's own
  transform, hence the inner element). An info marker holds the `i` and its text
  bubble; an empty bubble is hidden by CSS, so an unwritten note shows nothing.
- **Dragging.** `pointerdown` on a marker stops propagation — otherwise
  Marzipano would rotate the camera under the same gesture — and captures the
  pointer. Movement past 3 px moves the hotspot (`screenToCoordinates` back onto
  the scene) and updates the document in place; releasing without moving is a
  tap, which selects or deselects.
- **Phase separation.** The current scene's view decides where a new hotspot
  goes: the engine adds it at the camera's centre, asks for a guess at the arrow
  direction (the panorama's forward direction, snapped to eighths), and selects
  it.
- **Undo/redo** hands the engine a whole new document (`setData`). It rebuilds
  markers for each scene and leaves the Marzipano scenes alone, so the camera
  does not move and no tiles are fetched again.
- **`destroy()`** aborts every listener the engine added to the pano element
  (`AbortController`). The pano element is reused by the next tour, so without
  that a closed tour's handlers would survive and could act on the live one.

### The hotspot popup

The selected hotspot's editor is a shell-owned element handed to the engine,
which mounts it as a Marzipano hotspot at the selection's yaw/pitch. Being a
hotspot is what makes it stay with its marker: Marzipano moves it with the
camera and hides it when the marker turns behind the viewer.

Its panel would still run off the window at the edges, so `placeEditor` measures
the marker's projected point and the panel's box and decides the panel's offset:
centred on the marker, pushed inside a 10 px margin, above the marker when there
is no room below, then clamped. It runs on:

- the view's `change` event (camera and drag-rotate),
- `window` resize,
- a `ResizeObserver` on the panel (a note's textarea grows as it is written),
- and directly during a marker drag, which moves the marker without changing the
  view.

Not a frame loop: the earlier version measured every frame while a hotspot was
selected, which was correct but never idle.

**Gesture ownership.** The popup sits inside Marzipano's hotspot layer, where a
`pointerdown` starts a camera drag and a wheel zooms. The shell stops
`pointerdown` and `wheel` at the popup so its fields own their gestures; markers
stop their own `pointerdown`; what is left — a tap on the empty pano — deselects,
as does Escape.

## 5. Editing and saving

One write path for every kind of change:

1. The engine mutates the live document and reports `onEdit(label)`.
2. The shell pushes a snapshot and schedules a debounced save.
3. Saves are serialised; an edit arriving during a write keeps the document
   marked unsaved, so the exit flush still writes it.
4. Leaving a tour flushes first.

Hotspot indices shift when one is added or deleted, so markers are rebuilt from
the document rather than patched — a handful of elements, and the camera is
untouched either way.

## 6. The window

`frame: true`. The native frame is what gives window dragging, window buttons
and — on Windows — the application menu, which holds **Import ZIP…** and **Show
Tour Folder**. The window opens at 1280×800 on `#111` with `show: false` until
`ready-to-show`, to avoid a white flash. DevTools open only against the dev
server.

## 7. Failure behaviour

- A bad archive: the imported folder is removed again and the user is told no
  tour was found.
- A missing remembered tour: forgotten, and the start screen is shown.
- A failed save: reported in the chrome (`Not saved — …`), and the document
  stays marked unsaved so the next flush retries it.
- A deleted or moved tour while it is open: the save fails with a message rather
  than writing to the wrong place.
