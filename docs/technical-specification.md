# Project Specification: "Project Home Legacy" – A Reusable Virtual Tour Desktop Shell

## 1. Objective

To develop a cross-platform desktop application (the "Shell") built on Electron that serves as a dedicated, distraction-free viewer for 360° virtual tours. The software is "content-agnostic"; the user simply selects a tour to view it.

## 2. Core Architecture

### A. The Import Layer

Instead of a configuration file, the application provides a "Load Tour" interface. A tour can be provided in two formats:

- **A Folder:** A directory containing the tour files (including `index.html`).
- **A ZIP Archive:** A compressed file containing the tour files.

### B. The Execution Logic

1. **Startup**: The app checks for a saved path to the most recently used tour.
2. **Auto-load**: If a valid tour path exists, the app immediately launches the tour.
3. **Manual Load**: If no tour is active, the app displays a simple "Load Tour" screen with an "Import Tour" button.
4. **Processing**:
   - **Folders**: The app navigates to the selected folder and loads `index.html`.
   - **ZIP Files**: The app extracts the ZIP file to a temporary directory and loads the `index.html` from there.
5. **UI/UX**: The window is frameless/minimalist to ensure a dedicated software experience.

## 3. Technical Stack

- **Framework**: Electron.js
- **Bundler/Packager**: Electron Forge
- **View Engine Target**: Pannellum (HTML5/JavaScript)
- **Data Persistence**: `electron-store` (to remember the last loaded tour)
- **File Handling**: `adm-zip` (to handle ZIP imports)
- **CI/CD**: GitHub Actions

## 4. Automation Requirements (CI/CD)

The developer must provide a `.github/workflows/build.yml` file that automates the packaging process.

- **Trigger**: A "Release" or "Tag" in GitHub.
- **Build Matrix**: The workflow must trigger simultaneous builds for:
  - Windows (.exe installer and portable .zip)
  - macOS (.dmg and .app bundles)
  - Linux (.AppImage)
- **Artifacts**: The workflow must upload the finished binaries as GitHub Release assets.

## 5. User Workflow

1. Open the application.
2. If it's the first run, click "Import Tour" and select a folder or a ZIP file.
3. The application extracts/locates the tour and immediately displays the 360° view.
4. Subsequent launches will automatically load the last used tour.

## 6. Deliverables

1. Complete Source Code (Electron project).
2. The GitHub Actions Workflow (the YAML file for automated building).
3. Documentation on how to import different tour types.
4. A "Starter" Pannellum Folder (a sample `index.html` and one 360° image to test the build).
