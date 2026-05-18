import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    manifest: true,
    outDir: path.resolve(__dirname, '../static/aiedit/react/dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: './src/main.tsx',
    },
  },
})
