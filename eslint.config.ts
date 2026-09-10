import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import pluginPlaywright from 'eslint-plugin-playwright'
import pluginVitest from '@vitest/eslint-plugin'
import skipFormatting from 'eslint-config-prettier/flat'

// To allow more languages other than `ts` in `.vue` files, uncomment the following lines:
// import { configureVueProject } from '@vue/eslint-config-typescript'
// configureVueProject({ scriptLangs: ['ts', 'tsx'] })
// More info at https://github.com/vuejs/eslint-config-typescript/#advanced-setup

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{vue,ts,mts,tsx}'],
  },

  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**']),

  ...pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    ...pluginPlaywright.configs['flat/recommended'],
    files: ['e2e/**/*.{test,spec}.{js,ts,jsx,tsx}'],
  },

  {
    ...pluginVitest.configs.recommended,
    files: ['src/**/__tests__/*'],
    rules: {
      // `expectScopedStyleHook` (src/components/shell/__tests__/helpers.ts) and
      // `expectOriginAt` (components/__tests__/BitmapPanel.spec.ts) are custom
      // assertion wrappers — teach the rule they count as assertions.
      'vitest/expect-expect': [
        'error',
        { assertFunctionNames: ['expect', 'expectScopedStyleHook', 'expectOriginAt'] },
      ],
    },
  },

  {
    // src/core is the framework-free core (see src/core/index.ts). Enforced here
    // as well as by src/core/__tests__/framework-free.spec.ts — keep the two
    // forbidden lists in step. `reka-ui` joins the list: ADR-0009 §1 bans it in
    // src/core outright, and flat config *replaces* `no-restricted-imports`
    // rather than merging it, so the confinement rule below cannot add the ban
    // for src/core without dropping the vue/pinia one — it has to live here.
    name: 'app/core-is-framework-free',
    files: ['src/core/**/*.{ts,mts}'],
    ignores: ['src/core/**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'vue', message: 'src/core must stay framework-free.' },
            { name: 'pinia', message: 'src/core must stay framework-free.' },
            { name: 'vue-router', message: 'src/core must stay framework-free.' },
            { name: 'reka-ui', message: 'src/core must stay framework-free.' },
          ],
          patterns: [
            {
              group: ['@vue/*', '@vitejs/*', 'reka-ui/*'],
              message: 'src/core must stay framework-free.',
            },
          ],
        },
      ],
    },
  },

  {
    // The UI framework (Reka UI) is confined to the src/components/ wrapper
    // layer — the wrappers are the only seam (ADR-0009, #77). Everything else
    // imports the wrappers, never `reka-ui`. src/core has its own, stricter
    // override above; it is excluded here so the two do not fight over
    // `no-restricted-imports` (flat config replaces, it does not merge).
    name: 'app/reka-ui-confined-to-shell-chrome',
    files: ['src/**/*.{vue,ts,mts,tsx}'],
    ignores: ['src/components/**', 'src/core/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'reka-ui',
              message: 'reka-ui is confined to the src/components/ wrapper layer (ADR-0009).',
            },
          ],
          patterns: [
            {
              group: ['reka-ui/*'],
              message: 'reka-ui is confined to the src/components/ wrapper layer (ADR-0009).',
            },
          ],
        },
      ],
    },
  },

  skipFormatting,
)
