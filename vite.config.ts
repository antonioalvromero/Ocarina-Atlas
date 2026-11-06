import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { serviceWorker } from './pwa/plugin'

export default defineConfig({
  server: { host: true, port: 3000, allowedHosts: ['.local'] },
  preview: { host: true, port: 3000, allowedHosts: ['.local', 'oot.gousse.cool'] },
  resolve: { tsconfigPaths: true },
  plugins: [tailwindcss(), tanstackStart(), viteReact(), serviceWorker()],
})
