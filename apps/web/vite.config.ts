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

  /**
   * Both settings below exist for one reason: keeping `document` out of the scramble
   * worker. Neither works without the other, and the failure they prevent is invisible
   * in development.
   *
   * cubing.js solves scrambles in a worker it boots from a file it picks at runtime.
   * Vite compiles the dynamic import in that worker entry into a `__vitePreload(load,
   * deps)` call, and `__vitePreload` injects `<link rel="modulepreload">` tags for its
   * dependency chunks — so it reads `document`. There is no `document` in a worker, so
   * the worker throws `ReferenceError: document is not defined` on its first line, the
   * solver never answers, and the timer quietly serves a hand-rolled practice scramble
   * instead of a real one. The dev server never bundles, so none of this happens until
   * you build and run the thing.
   *
   * The saving grace is that `__vitePreload` skips the `document` work entirely when
   * `deps` is empty. So the fix is to leave the worker entry with no dependency chunks.
   */
  build: {
    /**
     * Fully off, not just `{ polyfill: false }`.
     *
     * The polyfill was one `document` user; the preload helper is the other, and it
     * stays even when the polyfill goes. Turning preloading off entirely is what drops
     * the stylesheet out of the worker entry's dependency list — the last entry keeping
     * that list non-empty.
     *
     * It costs the app nothing today: the client builds to a single entry chunk with no
     * lazily-loaded routes, so there is nothing for a preload hint to warm up.
     */
    modulePreload: false,

    rollupOptions: {
      output: {
        /**
         * Give every cubing.js module a chunk name of its own.
         *
         * Two things follow, and both are needed. The worker entry stops sharing a
         * chunk with our code — by default the bundler hoists the helpers it needs into
         * the application's entry chunk, so the worker began by importing the whole app
         * and evaluating it, `document` and all. And the modules it imports statically
         * end up beside it rather than in a dependency chunk, which is what finally
         * empties the `__vitePreload` dependency list.
         *
         * Naming them per module rather than folding the library into one `cubing`
         * chunk is what preserves cubing.js's own lazy splitting. It ships a chunk per
         * event, and a single chunk would make a 3x3x3 scramble pull down the solvers
         * for megaminx and the side events too — about 1.2 MB where 800 kB will do.
         */
        manualChunks(id: string) {
          const modulePath = /[\\/]cubing[\\/]dist[\\/]lib[\\/]cubing[\\/](.+)$/.exec(id)?.[1];
          if (modulePath === undefined) return undefined;

          const withoutExtension = modulePath.replace(/\.[^.]+$/, '');
          return `cubing-${withoutExtension.replace(/[\\/]/g, '-')}`;
        },
      },
    },
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
