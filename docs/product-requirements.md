# Product Requirements Document: HomeLegacy

## 1. Executive Summary & Vision

**HomeLegacy** is a dedicated desktop application designed to serve as a "digital time capsule" for residential spaces. Unlike a standard web browser, which is filled with distractions, HomeLegacy provides a minimalist, immersive environment specifically for viewing 360° virtual tours.

The mission is to empower homeowners to preserve the essence of their homes. By capturing a space in 360°, users can revisit the layout, the light, and the feeling of a home at a specific moment in time, ensuring that even after they move, the memories of that space remain accessible and vivid.

## 2. Target Audience

- **The Memory-Keeper:** Individuals or families who want to preserve the history of their family homes.
- **The New Homeowner:** People who want to document their "current" life before life changes.
- **Legacy Clients:** Professional photographers who want to provide a premium, branded "gift" experience to their clients, allowing them to revisit a home's essence years later.

## 3. User Stories

- **The "Walkthrough" Experience:** _As a user, I want to launch the app and immediately be transported into my old living room so I can relive the feeling of being there._
- **The Storyteller:** _As a user, I want to interact with hotspots in the tour so that I can read the story behind a specific corner of the house or view a photo of a holiday celebration that happened there._
- **The Easy Transition:** _As a user, I want to simply select a folder or a ZIP file of my tour so that I don't have to deal with complex software installations or file management._

## 4. Functional Requirements (Desktop - Phase 1)

### 4.1 Tour Import & Loading

- **Folder Import:** The app shall allow users to select a local directory containing the virtual tour files (must detect `index.html`).
- **Archive Import:** The app shall allow users to select a `.zip` archive. Upon selection, the app will extract the files to a temporary directory and load the tour.
- **Persistence:** The app shall remember the path of the most recently used (MRU) tour to allow for automatic loading on subsequent launches.

### 4.2 Execution Logic

- **Auto-Launch:** On startup, if a valid MRU tour path is found, the application shall launch the tour view immediately.
- **Manual Load:** If no tour is active (e.g., the last tour was deleted or the app is being run for the first time), the app shall present a clean "Import Your Home" interface.

### 4.3 The Viewing Environment

- **Frameless UI:** The application shall utilize a minimalist, frameless window to maximize immersion and remove browser-based distractions.
- **Content Agnostic:** The application acts as a specialized shell. While optimized for Pannellum-based tours, it shall support any standard HTML5/JavaScript-based virtual tour provided via an `index.html` file.

## 5. Non-Functional Requirements

- **Immersiveness:** The UI should stay "out of the way." There should be no browser address bars, bookmarks, or tabs.
- **Simplicity:** The user experience must be "one-click." From opening the app to seeing the home, the friction should be near zero.
- **Cross-Platform Availability:** The software must be deliverable as an installer for Windows, macOS, and Linux.

## 6. Future Roadmap: Mobile Expansion

To ensure these memories are accessible anywhere, the following features are planned for future development:

### 6.1 Mobile Companion App (iOS & Android)

- **Touch-Optimized Navigation:** Implementation of intuitive gestures (swipe to rotate, pinch to zoom) for a natural 360° exploration experience on mobile devices.
- **Mobile File Access:** Ability to import tours via mobile file systems (e.g., iOS Files app, Android File Manager) or via cloud storage (e.g., iCloud, Google Drive).
- **Platform Integration:** Utilizing frameworks like Capacitor or React Native to provide a native-feeling experience on both iOS and Android.
