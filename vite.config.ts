import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/circuit-finder/',
  build: {
    // The bundled Porto street network (src/data/porto-streets.json, ~584 KB
    // raw) is inlined into the JS bundle so there is no runtime fetch. That
    // pushes the single chunk past the default 500 KB notice; ~295 KB gzipped.
    chunkSizeWarningLimit: 800,
    // Two static pages built into the same dist/: the routes lookup (Phase 25's
    // primary entry) and the older manual drag/rotate tool, kept as a secondary page.
    rollupOptions: {
      input: { routes: 'index.html', manual: 'manual.html' },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
