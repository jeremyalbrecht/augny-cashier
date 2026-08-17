# augny-cashier

Nuxt 4 app for Augny Badminton's club finances:

- **Cashier** (`/`) — gym-tablet UI to register member purchases (shuttle boxes, merch, tournament fees).
- **Admin dashboard** (`/dettes`) — treasurer view: balances, payments, quarterly recap e-mails.

Single source of truth: Google Sheet **"Dettes adhérents 25/26"** (accessed via service account).

## Commands

```bash
npm run dev      # dev server — uses TMPDIR=/tmp (required on macOS to avoid vite-node socket EINVAL)
npm run build    # production build
npm test         # vitest run
npm run test:watch
```

There is no separate typecheck script; `npx nuxt typecheck` works. Project-wide `process`/`fs`/`path` errors are pre-existing (no `@types/node` configured) — ignore them unless you're adding `@types/node`.

## Three-tier auth model

The most non-obvious thing about the codebase. Three separate auth mechanisms coexist:

| Tier | Used by | How | Source of truth |
|---|---|---|---|
| Shared X-Token | Cashier (`/`, `/api/players`, `/api/prices`, `/api/push`, `/api/balance/[name]`, `/api/comitee`) | `X-Token` header or `?token=` query → cookie. Same token for everyone on the gym tablet. | `server/middleware/auth.ts` enforces. `runtimeConfig.token` = expected value. |
| Google OAuth + allowlist | Admin (`/dettes`, `/api/debts*`, `/api/payments`, `/api/send-summary*`) | Sign-in via `/auth/google`, session cookie. Email must appear in the `Comité` sheet's column A. | `requireAdmin()` in `server/utils/require-admin.ts` (60s in-memory cache of the allowlist). |
| None (public) | `/pay/[name]` (HelloAsso payment redirect) | No token, no session — deliberately, since it's clicked from a member's personal e-mail. Sensitivity is capped by design: the amount is always read server-side from the member's real balance, never taken from the URL/query, so the worst case is someone pays off another member's debt. | Lives at `server/routes/pay/[name].get.ts`, **outside `/api`**, so it isn't touched by the X-Token middleware at all (same trick `server/routes/auth/google.get.ts` uses). |

**To add a new endpoint, decide which tier it belongs to**:

- Admin → put its path prefix in `ADMIN_PATH_PREFIXES` in `server/middleware/auth.ts` (carves it out of X-Token), then call `await requireAdmin(event)` at the top of the handler.
- Cashier → don't touch the middleware (X-Token applies by default), don't call `requireAdmin`.
- Public → put it under `server/routes/` (not `server/api/`) so the X-Token middleware (which only gates `/api/*`) never sees it.

The frontend has a matching client-side carve-out in `app/middleware/token.global.ts` (`OAUTH_ROUTE_PREFIXES`) so `/dettes` doesn't require a token cookie.

## HelloAsso payment integration

Members can pay their debt by card via HelloAsso (free for non-profits) instead of bank transfer. Two entry points, one mechanism:

- The quarterly recap email (`server/utils/email-template.ts`) has a "💳 Payer par CB (HelloAsso)" button next to the RIB link.
- The cashier screen (`app/pages/index.vue`) shows the same button above the "Solde actuel" badge once a player with a positive balance is selected.

Both link to `/pay/[name]` (`server/routes/pay/[name].get.ts`), which looks up the member's live balance, calls the HelloAsso Checkout API (`server/utils/helloasso.ts`) to mint a **checkout-intent**, and 302-redirects there. This indirection exists because a checkout-intent's `redirectUrl` is only valid for **15 minutes** — it can't be embedded directly in an email sent hours or days before it's opened, so the link always points at our own stable URL, which mints a fresh intent at click time.

`server/utils/helloasso.ts` handles OAuth2 `client_credentials` auth against HelloAsso (access token cached in-memory, ~30 min TTL, re-fetched on expiry — no refresh-token juggling) and the `POST /v5/organizations/{slug}/checkout-intents` call.

**Not implemented**: reconciling completed HelloAsso payments back into the `Paiements` sheet. This integration only makes paying easier — it doesn't mark a debt as paid. A treasurer still needs to notice the HelloAsso payment and record it (or a future change could add a webhook for this).

## Where the business rules live

**`server/utils/debts.ts`** — every rule the system encodes:

- Parse French euros (`23,50 €`) and dates (`DD/MM/YYYY`, ISO, French verbose).
- `computeBalances()` runs over already-fetched sheet rows and produces a `PlayerBalance[]`. Pure, no I/O — easy to unit-test.
- **Cutoff filter**: rows before `cutoffDate` are excluded from `lines` / `payments`. Tournaments get the cutoff applied **after** the every-5th-free discount so positions count across the full season, not just the post-cutoff window.
- **Every-5th-free**: tournaments at indices 0, 4, 9, 14… are offered (matches legacy Python behaviour).
- **Tournois offerts**: substring match against the `Tournois offerts` sheet → `due = 0`.
- **Invoice tracking**: `invoicesTotal − paymentsTotalAll` clamped at 0 = `outstandingFromInvoices`. `unpaidInvoiceCount` is a FIFO walk in chronological order — partial-coverage invoice counts as unpaid.
- Unparseable tournament dates **are kept** (safer to over-bill than to silently drop) and flagged via `dateUnparseable`.

**`server/utils/email-template.ts`** — pure HTML template for the quarterly recap. Highlights: tests assert specific strings (`Bonjour X`, `Nx <b>RSL</b> (...) → ...`), so don't reformat those lines without updating tests. Logo URL is hardcoded to the club's public site — note the build-hash in the path is brittle.

## Sheet schema

Six worksheets, all read via `server/utils/load-debts.ts`:

| Sheet | Columns | Notes |
|---|---|---|
| `Joueurs` | Nom, Email, Licence (+ Enfant in the legacy Python) | Player roster. |
| `Tarifs` | Item, Catégorie, Prix | Catalog used by the cashier and to categorize Dettes rows. |
| `Dettes` | Nom, Item, Prix, Date | Append-only purchase log (the cashier writes here via `/api/push`). Negative prices = refunds. |
| `Tournois N` | Licence, Tournoi, Date, Lieu, Vainqueur, Finaliste, Montant dû, Paiement joueur | Tournament participation. Date column is French verbose, parsed by `parseSheetDate`. |
| `Tournois offerts` | Tournoi | Substring-matched against tournament names; matched ones are free. |
| `Comité` | Email (column A) | OAuth allowlist. Any row whose first column contains `@` is allowed. |
| `Paiements` | Nom, Montant, Date, Méthode, Note | Append-only payment ledger (`/api/payments` writes here). Created by hand the first time. |
| `Envois` | Nom, Montant, Date, Note | Append-only invoice ledger (every successful recap-send appends rows). Tracks "who got billed what" for FIFO matching. Created by hand the first time. |
| `Data` | A: label, B: value | Config sheet. Row whose A column contains "dernier envoi" → B column holds the cutoff date as `DD/MM/YYYY`. **Lookup is by label substring, not by fixed cell** — rows can be rearranged. |

Sheet names with spaces in A1 notation must be wrapped in single quotes inside the range string (`'Tournois N'!A1:Z2000`). The fetch helper assumes row 1 = headers (`server/utils/fetch.ts`).

## Side effects of the send-recap endpoint

`POST /api/send-summary` does up to **three** writes in this order:

1. **SMTP send** (one per recipient) — the only network call to a non-Google service.
2. **Append to `Envois`** — one row per successful send. If this fails, the response includes `envoisError` so the admin UI surfaces it.
3. **Update `Data!B<row>`** to today's date — only if at least one email actually went out. Locates the row by the "dernier envoi" label.

A partial failure here is recoverable: if writes 2 or 3 fail, you can manually append/update the sheet — the emails are already gone.

## Environment

`runtimeConfig` keys (see `nuxt.config.ts`) → env vars:

- `NUXT_TOKEN` — shared cashier secret (`token`)
- `NUXT_SA` — base64-encoded service-account JSON (`sa`)
- `NUXT_SESSION_PASSWORD` — `nuxt-auth-utils` session cookie key (32+ chars; `openssl rand -hex 32`)
- `NUXT_OAUTH_GOOGLE_CLIENT_ID` / `NUXT_OAUTH_GOOGLE_CLIENT_SECRET` — Google OAuth web client; redirect URI is `<origin>/auth/google`
- `NUXT_SMTP_USER` / `NUXT_SMTP_PASSWORD` — Gmail app password
- `GOOGLE_SHEET_ID` — spreadsheet ID (plain env, not runtimeConfig)
- `NUXT_HELLOASSO_CLIENT_ID` / `NUXT_HELLOASSO_CLIENT_SECRET` — HelloAsso API client (`helloasso.clientId`/`clientSecret`). **Not yet provisioned** — create a HelloAsso org (sandbox first: [helloasso-sandbox.com](https://www.helloasso-sandbox.com)), then generate an API client from its back office (Réglages → API) to get these.
- `NUXT_HELLOASSO_SANDBOX` — set to `"true"` to hit `api.helloasso-sandbox.com` instead of `api.helloasso.com` (`helloasso.sandbox`). Leave unset/`"false"` in production.
- `HELLOASSO_ORGANIZATION_SLUG` — the club's HelloAsso organization slug (plain env, matches the `GOOGLE_SHEET_ID` convention) — visible in the URL of the org's HelloAsso back office, e.g. `augny-badminton` in `helloasso.com/associations/augny-badminton`.
- `NUXT_PUBLIC_SITE_URL` — absolute origin of this app (e.g. `https://cashier.augny-badminton.fr`), used to build the `/pay/[name]` link inside recap e-mails (`publicSiteUrl`). Without it, the payment button is simply omitted from the e-mail (the cashier-screen button doesn't need it — it uses a relative URL). If unset, `/pay/[name]` itself still falls back to the request's own host for its HelloAsso `backUrl`/`errorUrl`/`returnUrl`.

## Tests

Run with `npm test`. Two suites:

- `tests/debts.test.ts` — date parsing, euro parsing, every-5th-free, cutoff filtering, FIFO invoice matching.
- `tests/email-template.test.ts` — template rendering, escaping, highlights.

New behaviour in `debts.ts` or `email-template.ts` should add tests — those modules are pure and easy to cover. Existing tests assert specific HTML fragments (`<b>RSL</b> (...) → ...`); if you change the email template's textual content, update tests in the same diff.

## Module augmentation

`auth.d.ts` at the project root augments `User`/`UserSession` from `nuxt-auth-utils` (so `session.user.email` is typed). Both `tsconfig.app.json` and `tsconfig.server.json` include `../*.d.ts`, which is why the file lives at the root and not in `server/types/` (the latter only resolves for server code).
