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

/** Splits large client vendor and static dataset modules into separate cacheable chunks without affecting SSR. */
function clientChunkSplittingPlugin(): Plugin {
  return {
    name: 'client-chunk-splitting',
    apply: 'build',
    configEnvironment(environmentName) {
      if (environmentName === 'client') {
        return {
          build: {
            rolldownOptions: {
              output: {
                manualChunks(id) {
                  const normalized = id.replace(/\\/g, '/')
                  if (
                    normalized.includes('/node_modules/react/') ||
                    normalized.includes('/node_modules/react-dom/') ||
                    normalized.includes('/node_modules/scheduler/')
                  ) {
                    return 'react-vendor'
                  }
                  if (normalized.includes('/node_modules/@tanstack/')) {
                    return 'router-vendor'
                  }
                  if (normalized.endsWith('/src/data/oot.json')) {
                    return 'oot-data'
                  }
                },
              },
            },
          },
        }
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
    clientChunkSplittingPlugin(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    serviceWorker(),
  ],
})
