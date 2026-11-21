import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shaulavo/hotkeys': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
  },
  test: {
    name: '@shaulavo/hotkeys',
    dir: './tests',
    watch: false,
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
})
