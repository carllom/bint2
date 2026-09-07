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
  },

  {
    // src/core is the framework-free core (see src/core/index.ts). Enforced here
    // as well as by src/core/__tests__/framework-free.spec.ts.
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
          ],
          patterns: [
            { group: ['@vue/*', '@vitejs/*'], message: 'src/core must stay framework-free.' },
          ],
        },
      ],
    },
  },

  skipFormatting,
)
