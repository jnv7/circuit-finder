import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/circuit-finder/',
  build: {
    // The bundled Porto street network (src/data/porto-streets.json, ~584 KB
    // raw) is inlined into the JS bundle so there is no runtime fetch. That
    // pushes the single chunk past the default 500 KB notice; ~295 KB gzipped.
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
