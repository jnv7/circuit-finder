import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/circuit-finder/',
  test: {
    include: ['src/**/*.test.ts'],
  },
})
