import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Unmount everything between tests. Without this, components from a previous test are
// still in the document and queries like getByRole match the wrong element.
afterEach(() => {
  cleanup();
});
