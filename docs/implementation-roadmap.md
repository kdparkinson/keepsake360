# Implementation Roadmap

What is built, and what is next. Shipped items describe the code as it stands;
the final section is a set of candidates, not commitments.

## Phase 1 — The shell (done)

- Electron Forge + Vite project with main, preload and renderer targets.
- One `BrowserWindow`, standard native frame, dark background, no browser chrome.
- A landing screen that says what the app is and offers to import.

## Phase 2 — Import (done)

- ZIP import through a native dialog.
- The archive is extracted into a library folder rather than a temp directory,
  because edits are written back into the tour.
- The tour is found inside the archive (`data.js` at the root or in one wrapper
  folder), and the folder that has both `data.js` and `tiles/` is treated as the
  tour — bigger exports ship a stale top-level `data.js` beside `app-files/`.
- A folder import was designed and then dropped: the archive is the format the
  app writes, and only a tour archive reliably identifies a tour.

## Phase 3 — The library (done)

- Tours live in `~/Documents/keepsake360/<slug>/`.
- The start screen lists them: the tour's own name, its unique folder, open and
  delete.
- Delete asks for confirmation, removes the whole folder, and refuses the tour
  that is open.
- The last opened tour is remembered and reopened on launch; a missing one is
  forgotten.

## Phase 4 — Viewing (done)

- Marzipano viewer built in the window, one scene per room.
- Link markers navigate; note markers reveal their text on hover or focus.
- An unwritten note shows no bubble at all.
- The camera survives everything the chrome does.

## Phase 5 — Editing (done)

- View/Edit modes on one page, with no camera movement across the switch.
- Add a note or a link at the camera's centre; drag any marker to move it.
- Note text; link target; arrow direction on a dial that snaps to eighths of a
  turn, with a guess applied when the link is created.
- The selected hotspot's fields live in a popup beside the marker, clamped into
  the window and dismissed by Escape, by tapping the room, or by deselecting.
- Delete a hotspot from its popup.
- Autosave into the tour's `data.js`, atomic write, with a `Saved` / `Not saved`
  indicator.
- Undo and redo over the whole document, one gesture per step.
- The tour's name is editable in the chrome and is what the library lists.

## Phase 6 — Leaving (done)

- **Exit** flushes pending edits and returns to the library.
- **Export & exit** zips the tour folder as-is, then leaves; a cancelled export
  keeps the tour open.
- Exported archives re-import here, open in a browser, and open in the hosted web
  editor.

## Phase 7 — Polish (done)

- Popups kept on screen, then shortened to one line each.
- The note field grows with the text.
- Readable contrast on the landing screen's import button.
- Focus lands in a new note's field.

## Phase 8 — Scene navigation (done)

- A scene nav down the left of the stage lists every scene, top to bottom.
- Each row is a square of the scene's starting view — one tile the tour already
  ships, at the smallest level, for the cube face the scene opens looking at —
  with the scene's name beneath it.
- Picking a row walks into that scene; the scene on screen is marked whether it
  was reached from the nav or by a link arrow.
- The nav is read-only: scenes are still named and ordered by the tour itself.

## Next — candidates

Roughly in the order they would pay off:

1. **Room management.** Rename, reorder and delete scenes. This is bigger than
   it looks: the tour's own `index.html` carries a scene list, so a scene edit
   has to keep that in step with `data.js`.
2. **A stable tour identity.** A `.zip` re-imported becomes a second library
   entry. A single-file container (`.ks360`) with a tour id would let an import
   recognise a tour it already has. Best treated as an export container, not the
   live format — the live format is `data.js` in a folder, which is what keeps
   the tour openable everywhere else.
3. **Arrow direction without a guess.** The current guess holds every new arrow
   along the panorama's forward direction, which is arbitrary but consistent.
   Two linked rooms could instead face each other: derive each arrow from the
   pair and let the dial adjust it.
4. **Tests.** The save writer and the library resolver are pure enough to test
   under Node without a window; the undo stack likewise.
