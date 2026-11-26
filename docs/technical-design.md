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
├── scene-nav.ts         the scene nav beside the stage
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
- **`goToScene(id)`** switches scene and reports the arrival through
  `onSceneChange`, dropping the selection on the way out. Link markers and the
  scene nav both use it, so "where the tour is" has one definition.
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

### Scene navigation

Marzipano calls a room a scene, and so does the tour data; the nav uses that
name. A rail down the left of the stage lists every scene, top to bottom, each
as a square of the scene's starting view with its name beneath it. The stage
reserves a gutter for it (`--scene-nav-space`): the pano starts where the rail
ends, so a click on a row never reaches Marzipano's drag handlers and a link
arrow can never sit under the rail. The chrome, the hotspot popup and the edit
bar stay clear of it too — the rail's top and bottom margins make room.

The square is not a render: it is one tile the tour already ships. The level is
the first without `fallbackOnly` (its index is the `{z}` in a tile URL, so it is
often 1 rather than 0), and the face is the cube face nearest the camera's
forward vector for the room's `initialViewParameters` — the same vector
`RectilinearView` projects from. A tour with no tiles still gets the square,
empty, and a tile that 404s removes its image rather than leaving a broken box.

Picking a square calls `engine.goToScene(id)`, which is also what a link marker
does; it clears any selection first, because the editing popup lives in the old
scene's hotspot container. The engine reports every arrival through
`onSceneChange`, so the nav marks the current scene whether the tour was walked
with the nav or with an arrow. Navigation is not an edit: no history step and
no save.

The name beneath each square is a field, not a label: it reads as text until it
is hovered or focused, the same way the tour's name does in the chrome. It is a
`textarea` sized to its content so an export's long panorama name wraps and
stays readable rather than being elided in a 128 px column. Typing
calls `engine.setSceneName(id, name)`, which writes `scenes[].name` and reports
`onEdit('scene-name:<id>')` — so a rename is one undo step per scene and is
autosaved like any other edit, and a link marker's `Go to …` label follows it.
Only `data.js` changes: the export's own `index.html` fills its scene list from
`APP_DATA` at runtime, so the browser viewer picks the new name up with no
rewrite. Undo re-renders the nav from the restored document and re-applies the
active mark, because the fields hold the names.

A row can also be dragged into a new place. The gesture belongs to the row:
`pointerdown` records its index, movement past 4 px lifts it, and the row is
moved through its siblings as the pointer travels, so the list is already in the
new order on release. The pointer is captured only once a drag has started — a
plain click is never captured, so the square still reaches its own click. Nothing
inside a row may begin a browser drag of its own (the thumbnail image is
`draggable = false` and `pointer-events: none`), because that would fire
`pointercancel` and end the reorder instead of moving the row.

A drop reports `(from, to)`; the shell splices `scenes`, redraws the rail and
records an edit. The order in `data.js` is the order the exported viewer lists
its rooms and the room it opens on, so the drop is undoable and saved like any
other change. The click that ends a drag is swallowed so a reorder never also
walks into a scene; a keyboard activation is unaffected.

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
and — on Windows — the application menu, which holds **Import ZIP…**, **Show
Tour Folder** and **Choose Tour Folder…**. The window opens at 1280×800 on `#111` with `show: false` until
`ready-to-show`, to avoid a white flash. DevTools open only against the dev
server.

The start screen states where tours are kept, with **Change…** beside the import
button; that and the menu item open the same picker. A tour is an ordinary
folder, so the library can sit anywhere the user can write. The choice lives in
`electron-store` and the main process owns it, like every other path: the
renderer only reads the folder for display. Changing it is refused while a tour
is open, because that tour's folder is what a save writes into, and it offers to
bring the existing tours along so the library does not look emptied.

## 7. Failure behaviour

- A bad archive: the imported folder is removed again and the user is told no
  tour was found.
- A missing remembered tour: forgotten, and the start screen is shown.
- A failed save: reported in the chrome (`Not saved — …`), and the document
  stays marked unsaved so the next flush retries it.
- A deleted or moved tour while it is open: the save fails with a message rather
  than writing to the wrong place.
