/**
 * Vite config for the renderer (frontend) process.
 *
 * Used by both Tauri (`tauri dev` / `tauri build`) and standalone dev.
 * Replaces the `renderer` section of the old `electron.vite.config.ts`.
 */

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { analyzer } from 'vite-bundle-analyzer'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    process.env.ANALYZE === 'true' && analyzer(),
  ].filter(Boolean),
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  root: resolve(__dirname, 'src/renderer'),
  build: {
    outDir: resolve(__dirname, 'out/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
