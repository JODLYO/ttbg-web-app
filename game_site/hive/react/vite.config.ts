import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  // hive-core and evaluator-ort-web are symlinked in from the sibling
  // hive-app repo (file: dependencies), so without this their imports
  // resolve against hive-app's own node_modules -- bundling a second copy
  // of onnxruntime-web (and its WASM) alongside this app's.
  resolve: {
    dedupe: ['hive-core', 'onnxruntime-web'],
  },
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
