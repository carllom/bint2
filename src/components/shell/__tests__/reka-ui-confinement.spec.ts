import { beforeAll, describe, expect, it } from 'vitest'
import { ESLint } from 'eslint'

// Mechanical proof of the acceptance criterion "eslint fails on a `reka-ui`
// import from anywhere outside `src/components/**`" (#77, ADR-0009), paired with
// the `app/reka-ui-confined-to-shell-chrome` rule in eslint.config.ts the way
// framework-free.spec.ts is paired with `app/core-is-framework-free`.

let eslint: ESLint

beforeAll(() => {
  // vitest sets cwd to the repo root (see vitest.config.ts `root`).
  eslint = new ESLint({ cwd: process.cwd() })
})

/** The `no-restricted-imports` messages ESLint would raise for `code` at `filePath`. */
async function restrictedImportErrors(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath })
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === 'no-restricted-imports')
    .map((message) => message.message)
}

const IMPORT_ROOT = "import { AccordionRoot } from 'reka-ui'\n"
const IMPORT_SUBPATH = "import { AccordionRoot } from 'reka-ui/namespaced'\n"

describe('reka-ui is confined to the src/components/ wrapper layer', () => {
  it('rejects a reka-ui import from src/ outside src/components/**', async () => {
    expect(await restrictedImportErrors('src/stores/example.ts', IMPORT_ROOT)).not.toEqual([])
    expect(await restrictedImportErrors('src/views/example.ts', IMPORT_SUBPATH)).not.toEqual([])
  })

  it('still rejects reka-ui inside src/core/** (framework-free rule stands)', async () => {
    expect(await restrictedImportErrors('src/core/example.ts', IMPORT_ROOT)).not.toEqual([])
    expect(await restrictedImportErrors('src/core/example.ts', IMPORT_SUBPATH)).not.toEqual([])
  })

  it('allows reka-ui inside the src/components/ wrapper layer', async () => {
    expect(await restrictedImportErrors('src/components/shell/Example.ts', IMPORT_ROOT)).toEqual([])
    expect(await restrictedImportErrors('src/components/Example.ts', IMPORT_ROOT)).toEqual([])
  })
})
