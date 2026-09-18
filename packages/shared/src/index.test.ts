import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('toolchain smoke test', () => {
  it('resolves and runs code from the shared package', () => {
    expect(PACKAGE_NAME).toBe('@cube-coach/shared');
  });
});
