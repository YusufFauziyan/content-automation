import { defineConfig } from 'vitest/config';

/**
 * Test configuration.
 *
 * `tests/unit`        — pure, fully mocked, no I/O.
 * `tests/integration` — requires the Docker PostgreSQL instance; never talks to
 *                       production APIs (see PROJECT_RULES.md "Testing").
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/**/*.d.ts'],
    },
  },
});
