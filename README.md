# vue-ts-template

A reusable starting point for browser apps built with Vue 3 + TypeScript. Click **Use this template** on GitHub to start a new app from it.

## Stack

- **Build**: Vite
- **Framework**: Vue 3 + TypeScript (`vue-tsc` for type-checking)
- **Routing**: Vue Router
- **State**: Pinia (installed and wired; no persistence plugin by default — see below)
- **Icons**: [@lucide/vue](https://lucide.dev/)
- **Unit tests**: Vitest + `@vue/test-utils` + `happy-dom`
- **E2E tests**: Playwright (config + one example spec)
- **Linting/formatting**: ESLint (flat config, Vue + TypeScript rules) + Prettier
- **CI/CD**: GitHub Actions — a `ci.yml` gate on every PR (lint, type-check, unit, e2e) and a `deploy.yml` that builds and deploys to GitHub Pages on push to `main`

## Getting started from this template

1. Click **Use this template** → **Create a new repository**.
2. Clone your new repo and run `npm install`.
3. In your new repo's GitHub settings, go to **Settings → Pages** and set **Source** to **GitHub Actions** (one-time, GitHub doesn't let this be pre-configured by a template).
4. Update the `name` field in `package.json`.
5. Start building — `npm run dev`.

The deploy workflow reads the repository name automatically and passes it as Vite's `--base` flag, so the built site resolves correctly at `https://<owner>.github.io/<repo>/` without any edits. If you're deploying to a custom domain or a user/org root page instead, remove the `--base` flag in `deploy.yml`.

## Opt-in: persisting Pinia state

Pinia is wired up, but no persistence plugin is installed by default — whether and how state should survive a reload is an app-level decision, not a template one. To add it:

```sh
npm install pinia-plugin-persistedstate
```

```ts
// main.ts
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)
```

## Scripts

```sh
npm run dev          # dev server
npm run build        # type-check + production build
npm run preview      # preview the production build locally

npm run test:unit    # Vitest
npm run test:e2e     # Playwright (install browsers first: npx playwright install)

npm run lint         # ESLint (--fix)
npm run format       # Prettier (--write, src/)
npm run type-check   # vue-tsc --build
```

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).
