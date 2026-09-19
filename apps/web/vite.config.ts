import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
// vitest/config re-exports Vite's defineConfig with the `test` key added to the type.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],

  /**
   * The scramble solver is a module worker, so anything the bundler emits for a worker
   * has to be a module too. The default is a classic script, which cannot use `import`
   * and fails to instantiate.
   */
  worker: { format: 'es' },

  build: {
    /**
     * Off, because the polyfill breaks the scramble worker.
     *
     * Vite injects a module-preload polyfill for older Safari, and it touches
     * `document` at module scope. When the bundler folds it into a chunk the scramble
     * worker imports, the worker dies on its first line with `document is not defined`
     * — there is no `document` in a worker — and the timer sits on "Generating
     * scramble…" forever.
     *
     * It only happens in a built bundle, never with the dev server, so it is invisible
     * until you actually build and run the thing.
     */
    modulePreload: { polyfill: false },
  },

  server: {
    port: 5173,

    /**
     * Forward API calls to the API process, so the browser only ever sees one origin.
     *
     * Production serves both from the same process (ADR-0017). Proxying in development
     * makes the two match, which matters because the session cookie is `sameSite: 'lax'`
     * and a difference here would only show up once deployed.
     */
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
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
