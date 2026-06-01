import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'scripts/hooks/events/__tests__/**/*.test.js',
      'scripts/hooks/core/__tests__/**/*.test.js',
    ],
    testTimeout: 10000,
  },
});
