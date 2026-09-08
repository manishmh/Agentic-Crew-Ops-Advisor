import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api': process.env.CREWOPS_API_PROXY_TARGET ?? 'http://127.0.0.1:8080',
      '/health': process.env.CREWOPS_API_PROXY_TARGET ?? 'http://127.0.0.1:8080',
    },
  },
})
