# GamesHub Server: Project Context

Current state, decisions, and conventions for the GamesHub backend.
Last updated: October 29, 2026.

## What it is

Backend API for a Unity minigame platform (team project, software dev class).
Daily-reset minigames; the backend tracks user accounts and score history.
The CS department chair wants it hosted publicly, so it is being built for real
deployment, not just a class demo. Not shipping until mid-December 2026 at the earliest.

## Current stack

- Node.js 24, Express 5.3, TypeScript 7, **ESM** (`"type": "module"`)
- Prisma **7.10.1, pinned exactly** (`prisma`, `@prisma/client`, `@prisma/adapter-mariadb`),
  `mariadb` driver 3.5.4, zod 4
- MySQL 8.4 in Docker (Docker Desktop on macOS)
- Server port 3900, configurable via `PORT`
- Git repo pushed to a remote; README setup instructions verified from a fresh clone after the Prisma 7 upgrade

## Project structure

```text
docker/
  Dockerfile           FROM mysql:8.4, COPY --chmod=0644 mysql-init/ into /docker-entrypoint-initdb.d/
  mysql-init/01-grant-dev-privileges.sh   GRANT ALL ON *.* to MYSQL_USER (dev only, for Prisma's shadow DB)
docker-compose.yaml    service "db": build ./docker, port 3306:3306, named volume db-data
prisma.config.ts       Prisma CLI config: schema path, migrations path, seed command, datasource URL
prisma/
  schema.prisma        generator "prisma-client" → ../src/generated/prisma; datasource has no url
  migrations/          init (games table), add_users (users table + hand-added CHECK constraint)
  seed.ts              idempotent upsert loop over a `games` list; imports `prisma` from src/db.js
src/
  index.ts             Express app and routes
  config.ts            loads .env if present, validates all env vars with zod, exports `config`
  db.ts                single shared PrismaClient, built with the MariaDB adapter
  errors.ts            HttpError class, notFound, errorHandler
  generated/prisma/    generated Prisma client (gitignored; run `npx prisma generate`)
.env / .env.example    MYSQL_ROOT_PASSWORD, MYSQL_DATABASE=GamesHub, MYSQL_USER=GamesHub,
                       MYSQL_PASSWORD, DATABASE_URL (mysql://...@127.0.0.1:3306/GamesHub), PORT=3900,
                       DB_ALLOW_PUBLIC_KEY_RETRIEVAL=true (local Docker only, see Prisma 7 notes)
```

npm scripts: `dev` (tsx watch src/index.ts), `typecheck` (tsc --noEmit), `db:seed` (prisma db seed).

tsconfig: `module`/`moduleResolution` are `NodeNext` (deliberately not Prisma's suggested `bundler`:
NodeNext makes tsc enforce Node's real ESM rules, so code that type-checks also runs under Node
after compilation). `include`: `src`, `prisma`, `prisma.config.ts`.

### Setup order (fresh clone)

`npm install` → copy `.env.example` to `.env` → `docker compose up -d --build` →
`npx prisma generate` → `npx prisma migrate dev` → `npm run db:seed` → `npm run dev`

### Why the Docker setup looks the way it does

- A bind mount of `docker/mysql-init` failed on macOS (script appeared executable inside
  the container, then "bad interpreter: Permission denied"). Fixed by copying the script
  into a custom image with explicit 0644 permissions, so MySQL sources it instead of executing it.
- Init scripts and `MYSQL_*` variables only apply when the volume is first created;
  changes require `docker compose down -v` then `docker compose up -d --build`.
- `.gitattributes` forces LF endings on `*.sh`.

## Configuration

- **App (`src/config.ts`):** calls `process.loadEnvFile()`, ignoring only ENOENT (no `.env` in
  production). Variables already set in the shell take precedence over `.env`. Zod schema:
  - `DATABASE_URL`: `z.url({ protocol: /^mysql$/ })`
  - `PORT`: coerced int 1–65535, default 3900
  - `DB_ALLOW_PUBLIC_KEY_RETRIEVAL`: `z.stringbool()`, default false (never `z.coerce.boolean()`:
    it treats the string "false" as true)
  - `refine`: the flag may only be true when the DATABASE_URL host is `localhost`, `127.0.0.1`,
    or `[::1]`; otherwise the server refuses to start
- **CLI (`prisma.config.ts`):** its own `loadEnvFile` guard plus Prisma's `env("DATABASE_URL")`.
  Deliberately does not import `src/config.ts`: the CLI needs only the database URL, and
  `prisma migrate deploy` should not require app secrets (token keys, email credentials) that
  `src/config.ts` will grow to validate.
- **db.ts:** parses `DATABASE_URL` with `new URL()` into adapter fields (host, port, user, password,
  database). Username and password go through `decodeURIComponent` (percent-encoded characters in
  generated passwords). One URL drives both the CLI and the app, so they cannot point at different databases.

## Database schema

Table collation is `utf8mb4_unicode_ci`: comparisons and unique indexes are case-insensitive
and accent-insensitive.

**Game** (`games`): `id` Int PK autoincrement, `slug` VarChar(64) unique, `name` VarChar(128).
One row per kind of minigame. Slugs are permanent and are what Unity uses.
Seeded games: `minesweeper`, `blackjack`, `price-is-nice`, `runner`, `sudoku`.

**User** (`users`):

| Column | Type | Notes |
|---|---|---|
| `id` | Int PK autoincrement | never exposed in responses |
| `email` | VarChar(254), unique | unique index is case-insensitive (`A@x.com` = `a@x.com`) |
| `password_hash` | VarChar(255) | argon2id encoded string |
| `display_name` | VarChar(16) | |
| `discriminator` | SmallInt | CHECK `BETWEEN 1000 AND 9999` (`users_discriminator_range`) |
| `email_verified_at` | DateTime(3), nullable | null = unverified |
| `created_at` | DateTime(3) | default now |
| `updated_at` | DateTime(3) | set by Prisma Client (`@updatedAt`), no DB default |

- Unique index on (`display_name`, `discriminator`). Because of the collation, `Dan#1234`,
  `DAN#1234`, and `Dán#1234` are the same tag (intended: blocks look-alike impersonation).
- The CHECK constraint is not expressible in `schema.prisma`; it was added by hand to the
  `add_users` migration SQL (created with `migrate dev --create-only`, edited, then applied).
  Verified that `migrate dev` leaves it alone and that `migrate reset` rebuilds it.
- Raw SQL inserts must set `updated_at` themselves.
- Not yet in the table, by design: password-change tracking (depends on the token design, step 5)
  and failed-login counters (step 6).

**Score** (planned, step 8): each score row holds `user_id` (foreign key); `User` gets a virtual
`scores Score[]` relation field (no column). Open: on account deletion, cascade-delete scores or
keep them detached (nullable `user_id`); leaderboard composite index depends on the puzzle design.

## API so far

- `GET /games/:slug` returns `{ slug, name }`
  - slug validated with zod: `/^[a-z0-9-]{1,64}$/` → 400 `invalid_slug`
  - not found → 404 `game_not_found`
- Unknown route → 404 `route_not_found`; unexpected errors → 500 `internal_error` (logged)
- `GET /hello` and `GET /boom` are temporary test routes, marked in code; remove before shipping
- `app.listen` callback rethrows startup errors (Express 5 passes them, e.g. EADDRINUSE)

## Conventions

- Every error response: `{ "error": { "code": "...", "message": "..." } }`.
  Clients branch on `code`; `message` is human-readable and may change.
- Routes throw `HttpError(status, code, message)`; the error handler formats all errors.
  HttpErrors are not logged; everything else is logged and returned as a generic 500.
  The handler delegates to `next(err)` if `res.headersSent`.
- Validate input with zod `safeParse` before touching the database.
- All environment access goes through `src/config.ts` (app) or `prisma.config.ts` (CLI);
  never read `process.env` elsewhere.
- Relative imports use `.js` extensions (`./db.js`), even in `.ts` files.
- Import the Prisma client only via `src/db.ts`; never construct another PrismaClient.
- Build responses field by field; never `res.json(row)` (avoids leaking ids, password hashes).
- DB tables and columns are snake_case via `@@map` / `@map`; code uses camelCase.
- Seed scripts are idempotent (`upsert`).
- Never edit an applied migration; create a new one. Editing a migration before it is applied
  (e.g. after `--create-only`) is fine. Applied migrations are checksummed in `_prisma_migrations`.
- **Never use `prisma db push`**: it bypasses migration files and would skip hand-written SQL
  such as the discriminator CHECK constraint.
- Git: track `prisma/migrations/` (including `migration_lock.toml`), `schema.prisma`, `.env.example`;
  never track `src/generated/`, `.env`, `node_modules/`.
- Run commands from the project root.

## Decisions made

- **Accounts:** email + password login with email verification and password reset.
  Public display name is Battle.net style, `Name#1234`: free display name plus a random
  4-digit discriminator (1000–9999), unique on the pair. Always display the full tag.
  Emails are private: never in API responses, leaderboards, or logs. (Exception: the
  development console email sender prints the recipient; production never logs addresses.)
- **Guests:** play without an account; scores stored only on the device. Guest scores are
  discarded when a guest registers. Unity should warn about this on the registration screen.
- **Unity:** one score-saving interface with local and API implementations (Strategy pattern).
- **Platforms:** WebGL is the primary target (itch.io is an option for hosting builds);
  downloadable builds possibly later. WebGL requires HTTPS and CORS on the API.
- **Hosting:** may get AWS resources from the department chair (not confirmed). Build portably:
  server packaged as a Docker image, all config via environment variables, email sending
  behind an interface (console output in development).
- **Prisma:** stay on 7.x, pinned exactly. Do not move to Prisma 8 until it supports MySQL.

### Registration (step 3), decided October 29, 2026

1. **Endpoint:** `POST /auth/register`, JSON body `{ email, password, displayName }`.
2. **Already-registered email:** the response is identical whether or not the email is in use,
   so the endpoint cannot be used to discover accounts. New address: verification email.
   Existing address: an email to its owner saying someone tried to register with it.
   - Consequence: the registration response cannot include the new tag (an existing address
     has no new tag to return). The client sees `displayName` and `discriminator`, as separate
     fields, after verification / at login. Login and password reset must use the same kind
     of generic responses, or the leak just moves there.
   - Consequence: registration sends email, so the email interface (with its console
     implementation) is built in step 3, not step 4.
3. **Passwords:** 12–128 characters, length rules only, no composition rules (NIST discourages
   them). Breached-password checking is a candidate for the hardening step.
4. **Display names:** `^[A-Za-z0-9_]{3,16}$`. ASCII only: blocks look-alike characters, and avoids
   JS (UTF-16) vs MySQL character-count mismatches. Can be widened later; narrowing is hard.
5. **Hashing:** argon2id via the `argon2` npm package. Node 24.7+ has a built-in `crypto.argon2()`,
   but it returns only raw bytes; the package also handles salts, the encoded hash format,
   constant-time verification, and rehashing when settings change. Native dependency with
   prebuilt Linux binaries; confirm in the Docker build (step 7).
6. **Discriminators:** `crypto.randomInt(1000, 10000)` (unpredictable), try the insert, on a
   unique violation of the tag index retry with a new number, max 5 attempts, then
   `409 display_name_unavailable`. The database decides collisions, so concurrent
   registrations cannot get the same tag.
7. Normalize email (trim + lowercase) before validation and storage; the case-insensitive
   unique index is the safety net, not the main mechanism.

## Open questions

- Where is the daily puzzle built from its seed?
  1. Unity (simple, keeps game logic in C#, but scores are client-reported and fakeable)
  2. Server (trustworthy scores, but every game's rules must exist in TypeScript)
  3. Both (cheat-resistant, but requires an identical seeded random generator in C# and TS)
  Can differ per game. Team decision pending.
- Score direction differs per game (lower-is-better vs. higher-is-better); likely a column on Game.
- Daily puzzle storage: probably one row per game per day holding the seed (and generator version).
- Scores on account deletion: cascade-delete or keep detached (see Score above).
- What happens to the hosted service after the semester ends.

## Prisma 7 notes (upgrade complete)

- **Versions:** install with an explicit `@7` and `--save-exact`; a bare `npm install prisma`
  resolves to the Prisma 8 line, which does not support MySQL. All three Prisma packages must
  have the same version. Prisma 7 is supported for 18 months after Prisma 8's general availability.
  Prisma recommends TypeScript 5.9; TypeScript 7 has worked so far.
- **Generator:** `provider = "prisma-client"`, `output = "../src/generated/prisma"`,
  `moduleFormat = "esm"`, `importFileExtension = "js"`. Prisma's docs suggest
  `importFileExtension = "ts"` if tsx fails with `Cannot find module './internal/class.js'`;
  that error did not occur, and `"ts"` would break a later `tsc` production build.
- **Nothing runs automatically anymore:** `migrate dev` does not generate the client, and
  `migrate dev` / `migrate reset` do not seed. Run `npx prisma generate` and `npm run db:seed` explicitly.
- **`prisma generate` requires `DATABASE_URL` to be set**, even though it never connects
  (`env()` is checked when the config loads). In the Docker build, give only that step a placeholder:
  `RUN DATABASE_URL="mysql://build:build@localhost:3306/build" npx prisma generate`.
  Do not loosen `prisma.config.ts`; a strict check gives clear errors for `migrate deploy`.
- **Pool settings (db.ts), chosen deliberately:**
  - `connectionLimit: 10` (driver default, written out; revisit for the hosted DB's connection limit)
  - `connectTimeout: 5_000` ms (driver default 1s is too tight across a network)
  - `idleTimeout: 300` seconds (driver default 1800s; cloud networks drop idle connections)
- **MySQL 8.4 authentication bug (found and fixed):** `caching_sha2_password` has a fast path
  (server-side cache) and a full path (needs RSA public key retrieval over non-TLS connections).
  The cache is emptied when MySQL restarts, so the app failed with "Pool failed to retrieve a connection"
  after every database restart until the CLI logged in first.
  - Development fix: `allowPublicKeyRetrieval` from `DB_ALLOW_PUBLIC_KEY_RETRIEVAL` (true in local `.env`).
  - Production: use TLS to the database instead; config.ts rejects the flag for non-local hosts.
  - If the server ever runs inside Docker Compose (host `db`), the guard will reject it by design;
    switch local development to TLS at that point rather than adding `db` to the allowed hosts.
- **Verification procedures:**
  - Restart test: stop the server, `docker compose restart db`, wait for `ready for connections`
    in `docker compose logs db --tail 5`, run no CLI command, start the server, request `/games/minesweeper`.
  - Database-down test: stop the db while the server runs; expect a 500 within ~10 s,
    then recovery without restarting the server once the db is back.

## Roadmap

1. ~~Upgrade to Prisma 7~~ (done October 29, 2026)
2. ~~Users table with the account design above~~ (done October 29, 2026)
3. Registration (next), in this order:
   - `express.json()` with a body size limit; map its errors in `errorHandler`
     (malformed JSON → 400, oversized body → 413) instead of the current 500
   - email interface with a console implementation
   - validation, argon2id hashing, discriminator assignment, generic response
4. Email verification and password reset (real email sender behind the interface)
5. Login with tokens, plus auth middleware for protected endpoints
6. Hardening: rate limiting on auth endpoints, security headers, CORS for WebGL;
   breached-password check; remove `/hello` and `/boom`; make sure the generic 500 message is neutral
7. Dockerfile for the server (placeholder `DATABASE_URL` for `prisma generate`; confirm argon2's
   native binary works in the image); production database user, TLS to the database,
   and `prisma migrate deploy`
8. Daily puzzles and scores, once the puzzle-generation decision is made

## Working style

The developer is building this step by step to understand every piece: explain each
step and the reasoning behind it, have them run commands themselves, and verify results
before moving on. To save usage, the developer pastes command output only when it doesn't
match what was expected.
