import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
