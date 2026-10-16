import { defineConfig } from 'vitest/config';

// The tests were written for Jest in the main CookingOS repo. Vitest runs them unchanged with
// `globals: true`, and needs no extra setup for TypeScript or `.ts` import paths.
export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
