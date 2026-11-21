import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // The renderer has two pages: the landing screen and the tour viewer.
      // Both must be emitted, or the main process has nothing to load when a
      // tour is imported from a packaged build.
      input: {
        index: 'index.html',
        viewer: 'viewer.html',
      },
    },
  },
});
