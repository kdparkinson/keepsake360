# Product Requirements: keepsake360

## 1. What this is

keepsake360 is a desktop application for keeping 360° tours of homes. It imports
a tour archive into a library on the user's computer, shows the tour in a
distraction-free window, and lets the owner maintain it afterwards — rename the
tour, write notes, move and add hotspots — without any other software.

The idea is a digital keepsake: a house captured at a moment in time, still
readable years later, in an app that needs no account and no network.

## 2. Who it is for

- **The memory-keeper.** A family documenting the home they are about to leave.
- **The new homeowner.** Someone recording how a house is now, before it changes.
- **The professional.** A photographer handing clients a keepsake they can open
  years later.

## 3. User stories

- _As a viewer, I open the app and I am looking at my home within a click._
- _As a viewer, I hover a note to read the story attached to a corner of a room,
  and click an arrow to walk into the next room._
- _As an owner, I import a tour once and see it on the start screen from then on._
- _As an owner, I rename a tour so the library stops calling it "Untitled
  Project"._
- _As an owner, I fix a note's wording, move a hotspot to the doorway it belongs
  on, and point a link at the right room._
- _As an owner, I add a note or a link while standing where it belongs, and it
  appears right there._
- _As an owner, I undo a mistake, and I can step forward again._
- _As an owner, I delete a tour I no longer want, with a confirmation._
- _As an owner, I take the tour with me: an export that is still an ordinary
  Marzipano archive._

## 4. Functional requirements

### 4.1 Import and library

- Import takes a `.zip` archive containing a tour (a `data.js` beside its
  `tiles/`, at the top level or inside one wrapper folder). Folders are not
  imported: the archive is the format the app writes and reads back.
- An imported tour is copied into the library at
  `~/Documents/keepsake360/<slug>/`, where later edits are written into its own
  `data.js`. (An archive name that is already taken gets `-2`, `-3`, …)
- The start screen lists the library: each tour's own name, with its unique
  folder beneath it, an open action and a delete action.
- The last opened tour is remembered and reopened on launch. If it has
  disappeared, the app forgets it and shows the start screen.
- An archive that holds no tour is rejected, and the half-imported folder is
  removed.

### 4.2 Viewing

- The tour fills the window under a standard, native window frame. There is no
  browser chrome, no address bar and no tabs.
- Rooms are navigated by clicking link arrows; notes open their text on hover or
  keyboard focus. A note that has not been written yet shows nothing at all
  rather than an empty bubble.
- The chrome stays out of the way: the tour name, a save indicator, the current
  selection (when editing), a View/Edit switch and Exit.

### 4.3 Editing

- Editing happens in the same window and on the same camera. Switching between
  viewing and editing never moves the view.
- A new hotspot is placed where the camera is looking. It can be dragged to a
  better spot; releasing without dragging selects it instead.
- **Notes** carry text. **Links** carry a target room and an arrow direction.
  An arrow is guessed when the link is created and can be turned by dragging the
  pip around a dial that snaps to eighths of a turn.
- The selected hotspot's editor appears beside it, as a small popup on the
  marker, and goes away when nothing is selected (or on Escape, or on a tap on
  the empty room). It contains that hotspot's fields and its delete action.
- Edits are saved as they are made, into the tour's own `data.js`; there is no
  Save button and no second copy.
- Undo and redo cover everything in the document — notes, links, arrows,
  positions, deletions and the tour's name — one gesture at a time.
- A tour's name is editable in the chrome and is what the library lists.

### 4.4 Leaving, exporting, deleting

- **Exit** leaves the tour and saves anything pending; the start screen is where
  you land, so leaving is not a dead end.
- **Export & exit** writes the tour as a `.zip` first and leaves only once the
  file exists. A cancelled export keeps the tour open.
- An exported archive is an ordinary Marzipano tour: it imports back into this
  app, opens in the browser, or opens in the hosted web editor.
- Deleting a tour asks first, removes the whole library folder, and refuses to
  delete the tour that is currently open.

## 5. Non-functional requirements

- **The disk is the source of truth.** What the app shows is what is in the
  tour's `data.js`; a save is atomic, so an interrupted write cannot leave a
  half-file.
- **The format stays standard.** Every edit is expressed in Marzipano's own
  `data.js` shape, so a tour edited here still opens elsewhere, and a tour edited
  elsewhere still opens here.
- **Immersive, not busy.** Dark, quiet chrome; the panorama is the interface.
- **Cross-platform.** Installers for macOS and Windows (Electron Forge, built by
  the GitHub Actions workflow).

## 6. Out of scope for now

- Managing rooms themselves (adding, renaming, reordering or deleting scenes,
  which also means rewriting the tour's own `index.html`).
- A single-file container with a stable tour id to stop a re-import creating a
  duplicate entry.
- Cloud syncing, accounts, and the mobile companion app.
