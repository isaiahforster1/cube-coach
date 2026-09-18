import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
// vitest/config re-exports Vite's defineConfig with the `test` key added to the type.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],

  server: {
    port: 5173,
  },

  test: {
    // happy-dom rather than jsdom: it is considerably faster and implements enough of
    // the DOM for component tests. If something it lacks becomes a problem, jsdom is a
    // drop-in swap.
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
