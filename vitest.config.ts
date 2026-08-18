import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The pure layer under src/contacts/ carries every unit test. It imports
    // from `asyar-sdk/contracts` at most, never from the role-asserting
    // `/view` or `/worker` entries, so it runs in plain Node with no DOM.
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
