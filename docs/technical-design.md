# Technical Design: Project Home Legacy

## 1. High-Level Architecture

We will follow the standard Electron multi-process architecture, but with a strict separation of concerns to ensure security and simplicity.

### A. The Main Process (The "Brain")

This process has full access to the computer's operating system. It will handle:

- **Lifecycle Management:** Starting the app, handling the "Close" event, and managing the window.
- **File System Access:** Opening the "Select Folder/File" dialog and extracting ZIP files.
- **Persistence:** Reading/Writing the "Last Used Tour" path using `electron-store`.
- **Window Management:** Creating the frameless window and loading the `index.html`.

### B. The Renderer Process (The "Window")

This is essentially a specialized web browser window. Its only job is to:

- **Display Content:** Rendering the HTML/JS/CSS of the tour.
- **User Interface:** Providing a minimal overlay (e.g., a "menu" or "close" button) that lives _on top_ of the tour.

---

## 2. The Component Stack

- **Runtime:** `Electron`
- **Build Tool:** `Electron Forge` (for creating the .exe, .dmg, and .app files)
- **Storage:** `electron-store` (to remember the last tour path)
- **Compression:** `adm-zip` (to handle the "Import ZIP" requirement)
- **Communication:** `Context Bridge` (the secure way for the "Window" to ask the "Brain" to do things, like "Open a new tour").

---

## 3. The Core Workflows (The "Logic Flow")

### Workflow 1: The "Startup" Sequence

1. **App Launches.**
2. **Main Process** asks `electron-store`: _"Is there a saved path for a tour?"_
3. **If YES:**
   - Check if the path/folder still exists on the hard drive.
   - If valid, create a `BrowserWindow` and point it at the `index.html` in that folder.
4. **If NO (or if path is invalid):**
   - Create a `BrowserWindow` and load a local `landing.html` (the "Import Your Home" screen).

### Workflow 2: The "Import" Sequence

1. User clicks "Import" on the landing screen.
2. **Main Process** triggers a `dialog.showOpenDialog`.
3. **User selects a Folder or a ZIP.**
4. **If Folder:**
   - Verify `index.html` exists.
   - Save the path to `electron-store`.
   - Clear the landing screen and load the tour.
5. **If ZIP:**
   - Create a unique temporary directory (e.g., in the OS Temp folder).
   - Use `adm-zip` to extract the contents into that directory.
   - Save the _temporary directory path_ to `electron-store`.
   - Load the `index.html` from that directory.

---

## 4. The "Frameless" UI Strategy

Since we want a distraction-free, immersive experience, we will use `frame: false` in the Electron window settings.

**The Challenge:** If there is no frame, there is no "X" button to close the app and no "File" menu to change tours.

**The Solution:** I propose a **"Minimalist Overlay"** strategy:

- A very small, semi-transparent icon (perhaps in the top-right corner) that only appears when the user moves their mouse near the edge of the screen.
- Clicking this icon opens a tiny, clean menu with three options:
  1.  **[+] Import New Tour**
  2.  **[?] Help/About**
  3.  **[X] Exit Application**

---

## 5. Proposed File Structure

```text
home-legacy/
├── src/
│   ├── main/
│   │   ├── main.js            <-- The "Brain" logic
│   │   ├── store.js           <-- Handles electron-store logic
│   │   └── file-manager.js    <-- Handles ZIP and Folder logic
│   ├── renderer/
│   │   ├── landing.html       <-- The "Import" screen
│   │   ├── landing.css
│   │   ├── overlay.html       <-- The minimal menu
│   │   └── overlay.css
│   └── assets/                <-- Icons and images for the app
├── package.json
└── ...
```
