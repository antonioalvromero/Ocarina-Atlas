import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { dataset } from '../src/lib/data'
import { precacheUrls } from '../src/lib/precache'

/** Emits sw.js next to the client bundle, with the list of files to keep offline. */
export function serviceWorker(): Plugin {
  return {
    name: 'field-atlas-service-worker',
    apply: 'build',
    applyToEnvironment: (environment) => environment.name === 'client',
    async writeBundle(options, bundle) {
      const urls = precacheUrls(dataset, Object.keys(bundle))
      const version = createHash('sha256').update(urls.join('\n')).digest('hex').slice(0, 12)
      const template = await readFile(join(this.environment.config.root, 'pwa/sw.js'), 'utf8')
      const header = `const VERSION = ${JSON.stringify(version)}\nconst PRECACHE = ${JSON.stringify(urls)}\n`
      await writeFile(join(options.dir ?? this.environment.config.build.outDir, 'sw.js'), header + template)
    },
  }
}
