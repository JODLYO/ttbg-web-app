import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  esbuild: {
    keepNames: true
  },
  // Without this, Vite assumes the app is served from the site root and
  // bakes absolute "/assets/..." URLs into the bundle for anything it
  // resolves at build time (e.g. the analysisWorker.ts Worker chunk) --
  // vite_tags.py/game_board.html manually construct the right URL for the
  // *entry* JS/CSS, which is why only this dynamic-worker case broke.
  base: '/static/hive/react/dist/',
  build: {
    sourcemap: true,
    minify: false,
    manifest: true,
    outDir: path.resolve(__dirname, '../static/hive/react/dist'), // output to Django static
    emptyOutDir: true,
    rollupOptions: {
      input: './src/main.tsx',
    },
  },
})
