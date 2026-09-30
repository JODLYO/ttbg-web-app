import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Without this Vite bakes absolute "/assets/..." URLs into anything it resolves at build
  // time -- notably the botWorker.ts Worker chunk -- while the templates build the entry
  // JS/CSS URLs by hand (see ditf_vite_tags.py). Same fix as the Hive app's config.
  base: '/static/dragon_in_the_forest/react/dist/',
  build: {
    // sourcemap: true,
    manifest: true,
    outDir: path.resolve(__dirname, '../static/dragon_in_the_forest/react/dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: './src/main.tsx',
    },
  },
})
