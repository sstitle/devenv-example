import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    include: ['y-codemirror.next'],
  },
  server: {
    proxy: {
      '/ws': {
        target: process.env.BACKEND_URL ?? 'http://localhost:8000',
        ws: true,
      },
    },
  },
})
