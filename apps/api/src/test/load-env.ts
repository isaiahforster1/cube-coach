// Load .env before any test runs. In CI the variables are already in the environment,
// so a missing file is not an error.
try {
  process.loadEnvFile('.env');
} catch {
  // Nothing to load.
}
