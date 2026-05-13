import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  esbuild: {
    keepNames: true
  },
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
