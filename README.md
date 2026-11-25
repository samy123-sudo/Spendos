# Spendos

**Plan before you spend.**

Spendos is a household money tracker: log spending, set budgets, watch recurring
costs, track what you owe and are owed, keep the paperwork together, and see
where the month actually went. It runs as a single-page React client on top of a
Cloudflare Worker API, with the ledger in D1 and uploaded documents in R2.

## Stack

| Layer    | Choice                                                        |
| -------- | ------------------------------------------------------------- |
| Client   | React 19, TypeScript, Vite 8 — hash-routed, no router library  |
| API      | Hono 4 on a Cloudflare Worker                                  |
| Data     | Cloudflare D1 (SQLite) for records, R2 for document files      |
| Build    | `vite build` for the client, `esbuild` for the Worker bundle   |

## Screens

Dashboard · Transactions · Budgets · Recurring · Calendar · Debts · Documents ·
Insights · Settings — all in `src/pages/`, navigation in `src/Spendos.tsx`.
Every page receives the same `AppState` snapshot and the shared
`refresh` / `saveSettings` / `notify` helpers.

## Project layout

```
index.html               shell, fonts, theme colour
src/
  main.tsx               entry point
  Spendos.tsx            app shell, navigation, state loading
  api.ts                 typed client for the Worker API
  types.ts               shared data model
  styles.css             design tokens and all component styles
  components/            Icon, charts, shared UI primitives
  pages/                 one file per screen
worker/index.ts          Hono app: schema, routes, hardening
scripts/build.mjs        bundles the Worker + writes the deploy manifest
wrangler.jsonc           local Worker config, D1 and R2 bindings
```

## Getting started

Requires Node 20.19+ or 22.12+ (Vite 8's engine requirement) and npm.

```bash
npm install
```

The app needs two processes: Vite for the client, and the Worker for the API.

```bash
# terminal 1 — API on http://127.0.0.1:8787
npm run api

# terminal 2 — client on http://127.0.0.1:5199
npm run dev
```

Vite proxies `/api` to port 8787 (see `vite.config.ts`), so open
<http://127.0.0.1:5199> and not the Worker port directly.

Other scripts:

```bash
npm run check   # tsc --noEmit
npm run build   # client into dist/client, Worker into dist/worker.js
```

## Data and configuration

`wrangler.jsonc` binds two resources for local development:

- `DB` — D1 database `spendos-local`
- `FILES` — R2 bucket `spendos-local`

The Worker creates its own tables on first request, so a fresh local database
starts empty. `src/types.ts` is the authoritative shape of the data:

- **transactions** — date, merchant, amount, type, category, account, note, tags,
  `needsReview` flag
- **settings** — currency, locale, household and members, categories, accounts,
  goals, budgets, subscriptions, recurring entries, assets and liabilities
- **documents** — upload metadata plus the R2 object key
- **debts**, **tags**, **rules**

Local state is written under `.wrangler/` (git-ignored). If the local D1 starts
failing with `SQLITE_READONLY`, point persistence somewhere outside a synced
folder:

```bash
npx wrangler dev --port 8787 --local --persist-to /tmp/spendos-d1
```

## API

| Method   | Path                     | Purpose                                       |
| -------- | ------------------------ | --------------------------------------------- |
| `GET`    | `/api/health`            | liveness check                                |
| `GET`    | `/api/state`             | full snapshot: transactions, docs, settings…   |
| `PUT`    | `/api/preferences`       | patch one or more settings fields              |
| `POST`   | `/api/transactions`      | add one or many entries, skips duplicates       |
| `PATCH`  | `/api/transactions`      | change category, tags or review flag            |
| `DELETE` | `/api/transactions`      | remove one entry                               |
| `POST`   | `/api/documents`         | multipart upload, stored in R2                 |
| `GET`    | `/api/documents/:id/file`| stream a stored document                       |
| `DELETE` | `/api/documents/:id`     | remove a document and its object               |
| `POST`   | `/api/debts`             | create a debt                                  |
| `PATCH`  | `/api/debts/:id`         | update a debt                                  |
| `DELETE` | `/api/debts/:id`         | delete a debt                                  |
| `DELETE` | `/api/state`             | wipe everything (requires a confirm phrase)    |

All SQL is parameterised. Wiping sends `{ "confirm": "DELETE ALL SPENDOS DATA" }`
and is compared in constant time.

## Security

Requests pass through a hardening layer in `worker/index.ts`:

- strict security headers and a CSP that only allows same-origin scripts
- state-changing requests from another origin are rejected (Origin and
  `Sec-Fetch-Site` are both checked)
- per-client rate limits on reads, writes and uploads
- caps on JSON body size, upload size, files per upload, stored documents,
  stored bytes and tag counts
- uploaded files are served with a content type derived from the extension,
  and any format that can execute in a browser (HTML, SVG, XML) is forced to
  download instead of rendering
- API responses are `no-store`; the site sends `noindex` and `no-referrer`

**There is no sign-in.** The Site link is the only access control, so anyone who
has the URL can read and edit the ledger. Do not share it outside the household.

## Deployment

`npm run build` produces `dist/worker.js`, `dist/client/` and
`dist/manifest.json` — the manifest describes the Worker entrypoint, the
compatibility date and the static assets directory, so the build output can be
uploaded as-is. Bind a D1 database to `DB` and an R2 bucket to `FILES` in the
hosting environment before the first deploy; the app creates its own tables, but
the bindings must exist.
