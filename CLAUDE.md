# augny-cashier

Nuxt 4 app for Augny Badminton's club finances:

- **Cashier** (`/`) — gym-tablet UI to register member purchases (shuttle boxes, merch, tournament fees).
- **Admin dashboard** (`/dettes`) — treasurer view: balances, payments, quarterly recap e-mails, payment reminders.
- **Espace adhérent** (`/mon-compte`, `/connexion`) — a member's own view of their balance, tournaments and past recaps, plus web-push reminders. Served at `compte.augny-badminton.fr`.

Business data lives in the Google Sheet **"Dettes adhérents 25/26"** (accessed via service account). Machine-generated auth state (magic codes, push subscriptions, reminder log) lives in **Cloudflare D1** — see "Storage split" below.

## Commands

```bash
npm run dev      # dev server — uses TMPDIR=/tmp (required on macOS to avoid vite-node socket EINVAL)
npm run build    # production build
npm test         # vitest run
npm run test:watch
```

There is no separate typecheck script; `npx nuxt typecheck` works. Project-wide `process`/`fs`/`path` errors are pre-existing (no `@types/node` configured) — ignore them unless you're adding `@types/node`.

## Three-tier auth model

The most non-obvious thing about the codebase. Three completely separate auth mechanisms coexist:

| Tier | Used by | How | Source of truth |
|---|---|---|---|
| Shared X-Token | Cashier (`/`, `/api/players`, `/api/prices`, `/api/push`, `/api/balance/[name]`, `/api/comitee`) | `X-Token` header or `?token=` query → cookie. Same token for everyone on the gym tablet. | `server/middleware/auth.ts` enforces. `runtimeConfig.token` = expected value. |
| Google OAuth + allowlist | Admin (`/dettes`, `/api/debts*`, `/api/payments`, `/api/send-summary*`, `/api/relances`) | Sign-in via `/auth/google`, session cookie. Email must appear in the `Comité` sheet's column A. | `requireAdmin()` in `server/utils/require-admin.ts` (60s in-memory cache of the allowlist). |
| Google OAuth **or** magic link + roster | Member (`/mon-compte`, `/api/member/*`) | Google sign-in, or a 6-digit code / one-tap link e-mailed via `/api/member/magic/*`. Email must match a `Joueurs` **Email** cell. | `requireMember()` in `server/utils/require-member.ts` (60s roster cache). Identifier resolution in `server/utils/roster.ts`. |
| None (public) | `/pay/[name]` (HelloAsso payment redirect) | No token, no session — deliberately, since it's clicked from a member's personal e-mail. Sensitivity is capped by design: the amount is always read server-side from the member's real balance, never taken from the URL/query, so the worst case is someone pays off another member's debt. | Lives at `server/routes/pay/[name].get.ts`, **outside `/api`**, so it isn't touched by the X-Token middleware at all (same trick `server/routes/auth/google.get.ts` uses). |

**To add a new endpoint, decide which tier it belongs to**:

- Admin → put its path prefix in `SELF_AUTH_PATH_PREFIXES` in `server/middleware/auth.ts` (carves it out of X-Token), then call `await requireAdmin(event)` at the top of the handler.
- Member → same carve-out (`/api/member` is already covered), then `await requireMember(event)`.
- Cashier → don't touch the middleware (X-Token applies by default), don't call either guard.

The frontend has a matching client-side carve-out in `app/middleware/token.global.ts` (`NON_TOKEN_ROUTE_PREFIXES`) so `/dettes`, `/mon-compte` and `/connexion` don't require a token cookie.

### Member auth: the two rules that are easy to break

**1. Sign-in is never gated on roster membership.** Any Google account may complete OAuth — `server/routes/auth/google.get.ts` deliberately does not check anything. `/api/member/me` returns `{ recognised: false }` for an unknown email and the page shows "contacte le comité". Telling a *signed-in* user their own address isn't on the roster leaks nothing, because they proved they own that mailbox.

**2. The magic-link endpoints must stay indistinguishable.** `POST /api/member/magic/request` returns the identical `{ ok: true }` for a match, a non-match, a match with no e-mail on file, and a rate-limit hit; `verify` returns one generic 400 for every failure. The form accepts **e-mail or licence number**, and licence numbers are low-entropy and semi-public — any observable difference turns this into a roster-scraping oracle. Correspondingly, the e-mail is **always sent to the address stored on the roster**, never to user input, or guessing a licence would let someone redirect another member's login.

Rate limiting keys on a hash of the raw input (`magic_requests`), not the resolved player, so probing licence numbers that match nobody still costs quota.

### An e-mail is an account, not a person

Several players share one address — a parent registers themselves and their children under it. In the live roster: **90 players, 82 distinct addresses, 7 shared** (one covering three players).

So `findPlayersByEmail()` (plural) is the correct lookup everywhere balances or notifications are involved; `findPlayerByEmail()` returns only the first and exists for places needing any single name (magic-link greeting, session display name). `requireMember()` returns `{ email, players[], names[], primaryName }` — iterate `players`, or children silently vanish.

**Roster order does not identify the account holder** — one shared address in the live sheet lists the child first. `/mon-compte` therefore labels a household by its e-mail, never by a name.

Push subscriptions are stored **one row per (player, device)**, so `UNIQUE(player_name, endpoint)` rather than on endpoint alone: a reminder aimed at a child must reach the parent's phone, the only device there is. `sendPushToPlayers` de-duplicates by endpoint so a household owing for two players still gets one notification, and prunes dead endpoints across every player they served.

`/mon-compte` renders one card per player. A player whose total is within ±0.01 collapses to a single "rien à régler" line — their existence is confirmed, but a breakdown of zeros is noise. A player in **credit** (negative total) still gets full detail.

### Debug impersonation (dev only)

```bash
NUXT_PUBLIC_DEBUG_AUTH=true npm run dev
```

Adds a purple box on `/connexion` that signs you in as **any** e-mail with no verification, via `POST /api/member/debug-login`. Pass an address that isn't on the roster to exercise the "adresse non reconnue" screen.

Two things worth knowing:

- **It also grants admin.** `requireAdmin` only checks the `Comité` sheet, so impersonating a committee address gives a working `/api/debts` session. That's the fastest way to get the full admin dataset for cross-checking member pages.
- **Verify UI features through the UI.** The endpoint working proves nothing about the page: this feature shipped once with a working endpoint and an invisible form, because the env var enabled only the server half.

It's `NUXT_PUBLIC_*` because both the browser (to render the form) and the server (to accept the request) read the same key — a server-only variable would enable half the feature and look broken. Publishing the flag costs nothing: **both sides also require `import.meta.dev`**, which is a compile-time constant, so `nuxt build` reduces the handler to an unconditional `throw 404` with `setUserSession` stripped out entirely. Setting the variable in Azure does nothing.

## Storage split

Google Sheets stays the human-editable business ledger. Cloudflare D1 holds machine-generated throwaway state that needs TTLs and atomic single-use semantics — things an append-only sheet is bad at, and that nobody would ever want to read by hand.

| Data | Where | Why |
|---|---|---|
| Joueurs, Tarifs, Dettes, Tournois, Paiements, Envois, Data | Google Sheets | The treasurer edits these by hand. |
| `magic_codes`, `magic_requests`, `push_subscriptions`, `reminders_sent` | Cloudflare D1 | Needs expiry and atomic consume; never human-edited. |
| Sessions | **Nowhere** | `nuxt-auth-utils` sessions are sealed cookies. "Stay logged in" is `runtimeConfig.session.maxAge` (60 days), not a table. |

The app runs on Azure Static Web Apps, so there is **no Workers binding** — D1 is reached over its REST API via `server/utils/d1.ts`. The ~100-200 ms round-trip is fine because nothing here is hot: magic codes are verified about once a month per member, and subscriptions are read only when sending pushes.

`reminders_sent` deliberately does **not** live in the `Envois` sheet: that sheet is the invoice ledger read by the FIFO unpaid-invoice walk in `debts.ts`, and reminder rows there would be counted as invoices and corrupt every balance.

Infrastructure is Terraform in `infra/` (Cloudflare provider v5 — note `rules` is a list *attribute*, written with `=`, not a repeated block). Schema in `infra/schema.sql`, applied with `wrangler d1 execute`; Terraform has no resource for that. The runtime D1 API token is created by hand on purpose — `cloudflare_api_token` would write the secret into state.

## Web push

`server/utils/push.ts` sends via `web-push`; `public/sw.js` is a hand-written service worker (no `@vite-pwa/nuxt` — the app is `ssr: false` and a precache would be actively harmful for a page whose job is showing a current balance).

**Reach is the thing to remember: there is no e-mail fallback.**

| Platform | Works? | Requires |
|---|---|---|
| Android (Chrome/Firefox/Edge), all desktop | ✅ | Just the permission prompt — no install. The primary path. |
| iOS/iPadOS Safari 16.4+ | ⚠️ | Must be added to the Home Screen first; `Notification.requestPermission` doesn't exist until then. |
| Chrome/Firefox on iOS | ❌ | Never — Safari underneath, no push API. |

So a member without a `push_subscriptions` row gets **nothing**. `sendPushToPlayers` returns `noSubscription` and the `/dettes` Relances modal must show it, or the UI will overstate reach. `app/composables/usePushNotifications.ts` distinguishes `needs-install` / `unsupported-ios` / `unsupported` / `denied` so the member page never renders a dead toggle.

Dead endpoints (404/410) are deleted on send — otherwise they accumulate forever.

`/auth/magic` has a 5-minute `REUSE_GRACE_MS` window: mail scanners (Outlook SafeLinks, antivirus gateways) prefetch links, and strict single-use would burn the token before the member ever taps it. The typed-code path stays strictly single-use.

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

⚠️ **Verified against the live sheet (Aug 2026)** — the real `Joueurs` column order is **A: Nom, B: Licence, C: Date de naissance, D: Email**, not what older notes claimed. It doesn't matter to most code (`getSheetData` maps by header name, so order is irrelevant), but it does matter to anything using a bounded range: **`/api/players` reads `Joueurs!A1:C100` and therefore cannot see the Email column at all.** `load-debts.ts` and `require-member.ts` read `A1:Z1000` and see everything.

| Sheet | Columns | Notes |
|---|---|---|
| `Joueurs` | Nom, Licence, Date de naissance, Email (+ Enfant in the legacy Python) | Player roster. 90 rows, all with an e-mail; 82 distinct addresses. |
| `Tarifs` | Item, Catégorie, Prix | Catalog used by the cashier and to categorize Dettes rows. |
| `Dettes` | Nom, Item, Prix, Date | Append-only purchase log (the cashier writes here via `/api/push`). Negative prices = refunds. |
| `Tournois N` | Licence, Tournoi, Date, Lieu, Vainqueur, Finaliste, Montant dû, Paiement joueur | Tournament participation. Date column is French verbose, parsed by `parseSheetDate`. |
| `Tournois offerts` | Tournoi | Substring-matched against tournament names; matched ones are free. |
| `Comité` | Email (column A) | OAuth allowlist. Any row whose first column contains `@` is allowed. |
| `Paiements` | Nom, Montant, Date, Méthode, Note | Append-only payment ledger (`/api/payments` writes here). Created by hand the first time. |
| `Envois` | Nom, Montant, Date, Note | Append-only invoice ledger (every successful recap-send appends rows). Tracks "who got billed what" for FIFO matching. Created by hand the first time. |
| `Data` | A: label, B: value | Config sheet. Row whose A column contains "dernier envoi" → B column holds the cutoff date as `DD/MM/YYYY`. **Lookup is by label substring, not by fixed cell** — rows can be rearranged. |

Sheet names with spaces in A1 notation must be wrapped in single quotes inside the range string (`'Tournois N'!A1:Z2000`). The fetch helper assumes row 1 = headers (`server/utils/fetch.ts`).

Money is **not** consistently formatted in the sheet — `Envois` has `112,00 €` while `Paiements` has `343,00€` (no space). `parseEuro` copes with both; don't "tidy" it into a stricter parser.

## ⚠️ Read-volume limit (unresolved — matters before launching /mon-compte)

**Every call to `/api/member/me` runs `loadAllBalances()`, which is 8 Google Sheets reads.** There is no caching layer: the only caches in the codebase are the 60 s allowlist/roster caches in `require-admin.ts` / `require-member.ts`, and neither covers the balance data.

The Sheets API allows ~60 read requests/minute. So roughly **7 member page-loads per minute saturates the quota**, and further requests get HTTP 429 and the page errors.

This was hit for real while testing: a script walking 82 addresses produced **368 rate-limit errors**, and the failures looked exactly like application bugs (`recognised: undefined`, empty player lists) until the server log was checked. If member pages start failing in clusters, **check for 429 before debugging the logic**.

It hasn't mattered so far because `/dettes` has ~5 users. It will matter the moment 90 members get a recap e-mail linking them to `/mon-compte`. Options if/when it bites: cache `loadAllBalances` server-side for a minute or two (balances change rarely — the cashier appends a row, and members tolerate a short lag), or have `/api/member/me` fetch only the rows for the caller.

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
- `NUXT_CLOUDFLARE_ACCOUNT_ID` / `NUXT_CLOUDFLARE_API_TOKEN` / `NUXT_CLOUDFLARE_D1_DATABASE_ID` — D1 REST access (`cloudflare.*`)
- `NUXT_VAPID_PUBLIC_KEY` / `NUXT_VAPID_PRIVATE_KEY` / `NUXT_VAPID_SUBJECT` — web push (`vapid.*`); generate with `npx web-push generate-vapid-keys`
- `NUXT_PUBLIC_VAPID_PUBLIC_KEY` — same public key, exposed to the browser so it can subscribe

Note: the GitHub Actions workflow only passes `GOOGLE_SHEET_ID`, `NUXT_SA` and `NUXT_TOKEN`. Everything else (OAuth, session password, SMTP, Cloudflare, VAPID) lives in the **Azure Portal app settings** — add new secrets there, not to the workflow.
- `NUXT_HELLOASSO_CLIENT_ID` / `NUXT_HELLOASSO_CLIENT_SECRET` — HelloAsso API client (`helloasso.clientId`/`clientSecret`). **Not yet provisioned** — create a HelloAsso org (sandbox first: [helloasso-sandbox.com](https://www.helloasso-sandbox.com)), then generate an API client from its back office (Réglages → API) to get these.
- `NUXT_HELLOASSO_SANDBOX` — set to `"true"` to hit `api.helloasso-sandbox.com` instead of `api.helloasso.com` (`helloasso.sandbox`). Leave unset/`"false"` in production.
- `HELLOASSO_ORGANIZATION_SLUG` — the club's HelloAsso organization slug (plain env, matches the `GOOGLE_SHEET_ID` convention) — visible in the URL of the org's HelloAsso back office, e.g. `augny-badminton` in `helloasso.com/associations/augny-badminton`.
- `NUXT_PUBLIC_SITE_URL` — absolute origin of this app (e.g. `https://cashier.augny-badminton.fr`), used to build the `/pay/[name]` link inside recap e-mails (`publicSiteUrl`). Without it, the payment button is simply omitted from the e-mail (the cashier-screen button doesn't need it — it uses a relative URL). If unset, `/pay/[name]` itself still falls back to the request's own host for its HelloAsso `backUrl`/`errorUrl`/`returnUrl`.

## Tests

Run with `npm test`. Five suites:

- `tests/debts.test.ts` — date parsing, euro parsing, every-5th-free, cutoff filtering, FIFO invoice matching.
- `tests/email-template.test.ts` — template rendering, escaping, highlights.
- `tests/roster.test.ts` — email/licence identifier resolution, normalisation, players with no email on file.
- `tests/magic-code.test.ts` — expiry boundary, single-use, attempt lockout, rate-limit window.
- `tests/reminders.test.ts` — the 14-day threshold, 7-day cooldown, unparseable dates.

New behaviour in the pure modules (`debts.ts`, `email-template.ts`, `roster.ts`, `magic-code.ts`, `reminders.ts`) should add tests — they take plain data and are easy to cover. Existing tests assert specific HTML fragments (`<b>RSL</b> (...) → ...`); if you change the email template's textual content, update tests in the same diff.

`vitest.config.ts` maps the `#server/*` alias so tests can import server utils. Without it, *value* imports through the alias fail to resolve (type-only imports happen to work because they're erased).

**`npx nuxt typecheck` is currently broken** in this repo — `vue-tsc` can't resolve `tsc` (`ERR_PACKAGE_PATH_NOT_EXPORTED`). Use `npm run build` as the type/import gate instead.

## Module augmentation

`auth.d.ts` at the project root augments `User`/`UserSession` from `nuxt-auth-utils` (so `session.user.email` is typed). Both `tsconfig.app.json` and `tsconfig.server.json` include `../*.d.ts`, which is why the file lives at the root and not in `server/types/` (the latter only resolves for server code).
