import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/circuit-finder/',
  build: {
    // The bundled Porto street network (src/data/porto-streets.json, ~584 KB
    // raw) is inlined into the JS bundle so there is no runtime fetch. That
    // pushes the single chunk past the default 500 KB notice; ~295 KB gzipped.
    chunkSizeWarningLimit: 800,
    // Three static pages built into the same dist/: the circuit list (Phase 28's
    // primary entry, index.html), the routes lookup it links into, and the older
    // manual drag/rotate tool, kept as a secondary page.
    rollupOptions: {
      input: { index: 'index.html', routes: 'routes.html', manual: 'manual.html' },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
