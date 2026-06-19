// Vite config for the Wails frontend. Mirrors the Tauri renderer config
// (root = src/renderer, @renderer/@shared aliases, Tailwind 4 + React Compiler),
// but builds to frontend/dist for `//go:embed all:frontend/dist`.

import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    babel({ presets: [reactCompilerPreset({ compilationMode: 'infer' })] }),
  ],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  root: resolve(__dirname, 'src/renderer'),
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
  server: {
    port: Number(process.env.WAILS_VITE_PORT) || 9245,
    strictPort: true,
  },
})
