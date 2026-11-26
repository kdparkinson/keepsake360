import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // The renderer is one page now: landing, viewing and editing are states
      // inside it, so there is no separate viewer page to emit.
      input: {
        index: 'index.html',
      },
    },
  },
});
