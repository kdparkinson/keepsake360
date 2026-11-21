# Implementation Roadmap: Project Home Legacy

## Phase 1: The Skeleton (Foundations)

_Goal: A running Electron app that opens a blank, frameless window._

1. **Project Scaffolding:** Initialize the project using Electron Forge and set up the directory structure (`src/main`, `src/renderer`, etc.).
2. **The Basic Shell:** Create a main process that spawns a single, frameless `BrowserWindow`.
3. **The "Hello World" Renderer:** Ensure the window displays a simple "Hello" message to confirm the connection between the Brain and the Window.

## Phase 2: The "Landing" Experience (Discovery)

_Goal: A functional app that can "find" a tour._

1. **The Landing Page:** Create the `landing.html` (the "Import Your Home" screen).
2. **File Selection (Folders):** Implement the "Select Folder" dialog in the Main process and pass the folder path to the Renderer.
3. **The "Tour Loader" Logic:** Implement the logic to look inside the selected folder for `index.html`.
4. **The "Switch" Mechanism:** Create the ability to tell the window: _"Stop showing the landing page, and start showing the content from this folder."_

## Phase 3: Memory & Sophistication (Persistence & ZIPs)

_Goal: An app that remembers where it was and handles archives._

1. **The "Brain's Memory":** Implement `electron-store` so the app remembers the last used tour path.
2. **The "Auto-Launch" Feature:** Modify the startup sequence so the app automatically skips the landing page if a valid tour was previously used.
3. **The "ZIP" Engine:** Implement the `adm-zip` logic to extract archives into a temporary directory and load them as tours.

## Phase 4: The "Polished" Experience (UX & UI)

_Goal: A professional-feeling product._

1. **The Minimalist Overlay:** Build the small, semi-transparent menu icon and the "Exit/Import/Help" menu.
2. **UI Styling:** Add CSS to the landing page and the overlay to make them feel "premium" and "minimalist."
3. **Error Handling:** Add "graceful failures" (e.g., _"Oops, we couldn't find a valid tour in that folder. Please try again."_).

## Phase 5: The "Delivery" (CI/CD)

_Goal: Generating the installers._

1. **GitHub Actions Setup:** Create the workflow to automate builds for Windows, macOS, and Linux.
2. **Release Testing:** Verify that the automated builds actually work and produce valid installers.
