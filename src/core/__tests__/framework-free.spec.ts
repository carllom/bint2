import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Mechanical enforcement of the design rule in src/core/index.ts: nothing under
// src/core may import a framework module. A convention that is only in a comment
// is not a rule. Paired with the eslint override for `src/core/**`.

const coreDir = join(dirname(fileURLToPath(import.meta.url)), '..')

const FORBIDDEN = /^(vue|pinia|vue-router|@vue\/.+|@vitejs\/.+)$/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(path)
    }
    return /\.(ts|mts|vue)$/.test(entry.name) ? [path] : []
  })
}

/** Specifiers of every static/dynamic import and `require` in the source. */
function importedSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const patterns = [
    /\bimport\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.push(match[1])
    }
  }
  return specifiers
}

const files = sourceFiles(coreDir)

describe('src/core is framework-free', () => {
  it('has at least one module (the rule needs something to guard)', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s imports no framework module', (file) => {
    const offending = importedSpecifiers(readFileSync(file, 'utf8')).filter((spec) =>
      FORBIDDEN.test(spec),
    )
    expect(offending, `${relative(coreDir, file)} must not import ${offending.join(', ')}`).toEqual(
      [],
    )
  })
})
