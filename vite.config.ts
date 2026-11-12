import { writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { serviceWorker } from './pwa/plugin'
import { lichiiTelemetryPlugin } from './src/lib/lichii-server'
import { resolveAllowedDevHosts } from './src/lib/server-network'

/** Bundles all npm dependencies into dist/server so production SSR needs no node_modules. */
function standaloneSsrPlugin(): Plugin {
  return {
    name: 'standalone-ssr-no-external',
    apply: 'build',
    configEnvironment(environmentName) {
      if (environmentName === 'ssr') {
        return {
          resolve: {
            noExternal: true,
          },
        }
      }
    },
    async writeBundle(options) {
      if (this.environment.name !== 'ssr') return
      const outDir = options.dir ?? this.environment.config.build.outDir
      if (outDir) {
        await writeFile(join(outDir, 'package.json'), '{\n  "type": "module"\n}\n')
      }
    },
  }
}

const allowedHosts = resolveAllowedDevHosts(hostname())

export default defineConfig({
  server: { host: true, port: 3000, allowedHosts },
  preview: { host: true, port: 3000, allowedHosts },
  resolve: { tsconfigPaths: true },
  plugins: [
    lichiiTelemetryPlugin(),
    standaloneSsrPlugin(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    serviceWorker(),
  ],
})
