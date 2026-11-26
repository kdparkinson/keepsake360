# keepsake360

A desktop app for keeping 360° tours of homes. Import a tour once, open it from
a library, and maintain it afterwards — rename it, write notes, add and move
hotspots — without any other software.

Built with Electron, Vite and [Marzipano](https://www.marzipano.net/).

## What it does

- **Keeps a library.** Importing a `.zip` copies the tour into Documents and
  lists it on the start screen by its own name.
- **Shows the tour** in a quiet window: drag to look around, click an arrow to
  walk into the next room, hover a note to read it.
- **Edits in place.** A View/Edit switch that never moves the camera; notes and
  links placed where you are looking, dragged into position, deleted from a
  popup beside the marker; a link's arrow set on a dial.
- **Saves as you go.** Every edit is written into the tour's own `data.js`, with
  undo and redo across the whole document.
- **Stays portable.** Export zips the tour back up as an ordinary Marzipano
  archive: it re-imports here, opens in a browser, and opens in the hosted web
  editor.

## Running it

Requires a recent Node.js (20 or newer) and npm.

```sh
npm install
npm start
```

That starts the Vite dev server and Electron together. Renderer changes
hot-reload; changes to `src/main.ts` or `src/preload.ts` need a restart. While
running against the dev server, DevTools open automatically.

Other scripts:

```sh
npm run typecheck   # tsc --noEmit
npm run lint        # oxlint + a formatting check (oxfmt)
npm run lint:fix    # fix both
npm run make        # build the installers with Electron Forge
```

## Where tours are stored

Everything lives in the Documents folder, one directory per tour:

```
~/Documents/keepsake360/<tour>/          # macOS and Linux
%USERPROFILE%\Documents\keepsake360\     # Windows
```

- The folder is named after the archive you imported (`my-house.zip` →
  `my-house/`), with `-2`, `-3` added if that name is taken.
- The tour inside is exactly what the archive held: `data.js` and `tiles/`, or
  both inside a wrapper folder such as `app-files/`.
- **Edits are written into that folder's own `data.js`**, not into a copy. The
  app is the editor; the folder is the document. Deleting a tour from the start
  screen removes its folder.
- Tours are kept out of the OS temp directory on purpose: temp gets reaped, and
  the edits would go with it.
- The most recently opened tour is remembered, and reopened on the next launch.

A tour is a [Marzipano](https://www.marzipano.net/) export: a `data.js` file that
assigns the whole document to `var APP_DATA`, beside the tile pyramid for each
room. Any tour in that shape can be imported, whether it came from this app, the
hosted editor, or Marzipano's own tool.

## Documentation

- [Product requirements](docs/product-requirements.md) — what the app is for and
  what it must do.
- [Technical specification](docs/technical-specification.md) — the tour format,
  storage, the custom protocol, IPC, saving and export.
- [Technical design](docs/technical-design.md) — processes, the one-page/three-
  state shell, the tour engine and the hotspot popup.
- [Implementation roadmap](docs/implementation-roadmap.md) — what is built, and
  the candidates for next.

## Releasing

`npm run make` builds the installers locally. Releases are produced by
[`.github/workflows/release.yaml`](.github/workflows/release.yaml).
