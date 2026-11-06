import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  server: { host: true, port: 3000, allowedHosts: ['.local'] },
  preview: { host: true, port: 3000, allowedHosts: ['.local'] },
  resolve: { tsconfigPaths: true },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
})
