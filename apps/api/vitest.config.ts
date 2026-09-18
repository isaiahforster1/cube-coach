import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./src/test/global-setup.ts'],
    // Test files share one database, so running them in parallel would let one file's
    // truncation wipe another's fixtures mid-test. Serial files keep that honest.
    // If the suite ever gets slow enough to matter, the fix is a database per worker,
    // not parallel writes to one.
    fileParallelism: false,
    setupFiles: ['./src/test/load-env.ts'],
  },
});
