# GamesHub Server: Project Context

Current state, decisions, and conventions for the GamesHub backend.
Last updated: October 29, 2026.

## What it is

Backend API for a Unity minigame platform (team project, software dev class).
Daily-reset minigames; the backend tracks user accounts and score history.
The CS department chair wants it hosted publicly, so it is being built for real
deployment, not just a class demo.

## Current stack

- Node.js, Express 5.3, TypeScript (CommonJS today; moving to ESM with Prisma 7)
- Prisma 6.x (**upgrade to Prisma 7 in progress**, see below)
- MySQL 8.4 in Docker (Docker Desktop on macOS)
- Server port 3900, configurable via `PORT` env var, loaded with `process.loadEnvFile()`
- Git repo pushed to a remote; README with setup instructions, tested from a fresh clone

## Project structure

```text
docker/
  Dockerfile           FROM mysql:8.4, COPY --chmod=0644 mysql-init/ into /docker-entrypoint-initdb.d/
  mysql-init/01-grant-dev-privileges.sh   GRANT ALL ON *.* to MYSQL_USER (dev only, for Prisma's shadow DB)
docker-compose.yaml    service "db": build ./docker, port 3306:3306, named volume db-data
prisma/
  schema.prisma
  migrations/          init (games table); possibly add_users (check with `npx prisma migrate status`)
  seed.ts              idempotent upsert loop over a `games` list
src/
  index.ts             Express app, routes, env loading
  db.ts                single shared PrismaClient
  errors.ts            HttpError class, notFound, errorHandler
.env / .env.example    MYSQL_ROOT_PASSWORD, MYSQL_DATABASE=GamesHub, MYSQL_USER=GamesHub,
                       MYSQL_PASSWORD, DATABASE_URL (mysql://...@127.0.0.1:3306/GamesHub), PORT=3900
```

npm scripts: `dev` (tsx watch src/index.ts), `typecheck` (tsc --noEmit).

### Why the Docker setup looks the way it does

- A bind mount of `docker/mysql-init` failed on macOS (script appeared executable inside
  the container, then "bad interpreter: Permission denied"). Fixed by copying the script
  into a custom image with explicit 0644 permissions, so MySQL sources it instead of executing it.
- Init scripts and `MYSQL_*` variables only apply when the volume is first created;
  changes require `docker compose down -v` then `docker compose up -d --build`.
- `.gitattributes` forces LF endings on `*.sh`.

## Database schema

**Game** (`games`): `id` Int PK autoincrement, `slug` VarChar(64) unique, `name` VarChar(128).
One row per kind of minigame. Slugs are permanent and are what Unity uses.
Seeded games: `minesweeper`.

Table collation is `utf8mb4_unicode_ci` (case-insensitive comparisons and unique indexes).

**User**: redesign decided, not yet built (see Accounts).

## API so far

- `GET /games/:slug` returns `{ slug, name }`
  - slug validated with zod: `/^[a-z0-9-]{1,64}$/` → 400 `invalid_slug`
  - not found → 404 `game_not_found`
- Unknown route → 404 `route_not_found`; unexpected errors → 500 `internal_error` (logged)

## Conventions

- Every error response: `{ "error": { "code": "...", "message": "..." } }`.
  Clients branch on `code`; `message` is human-readable and may change.
- Routes throw `HttpError(status, code, message)`; the error handler formats all errors.
  HttpErrors are not logged; everything else is logged and returned as a generic 500.
  The handler delegates to `next(err)` if `res.headersSent`.
- Validate input with zod `safeParse` before touching the database.
- Build responses field by field; never `res.json(row)` (avoids leaking ids, password hashes).
- Seed scripts are idempotent (`upsert`).
- Never edit an applied migration; create a new one.
- Run commands from the project root.

## Decisions made

- **Accounts:** email + password login with email verification and password reset.
  Public display name is Battle.net style, `Name#1234`: free display name plus a random
  4-digit discriminator (1000–9999), unique on the pair. Assign by trying the insert and
  retrying on a unique-constraint violation, with a retry limit. Always display the full tag.
  Emails are private: never in API responses, leaderboards, or logs.
- **Guests:** play without an account; scores stored only on the device. Guest scores are
  discarded when a guest registers. Unity should warn about this on the registration screen.
- **Unity:** one score-saving interface with local and API implementations (Strategy pattern).
- **Platforms:** WebGL is the primary target (itch.io is an option for hosting builds);
  downloadable builds possibly later. WebGL requires HTTPS and CORS on the API.
- **Hosting:** may get AWS resources from the department chair (not confirmed). Build portably:
  server packaged as a Docker image, all config via environment variables, email sending
  behind an interface (console output in development).
- **Prisma:** upgrade to Prisma 7, pinned (see below).

## Open questions

- Where is the daily puzzle built from its seed?
  1. Unity (simple, keeps game logic in C#, but scores are client-reported and fakeable)
  2. Server (trustworthy scores, but every game's rules must exist in TypeScript)
  3. Both (cheat-resistant, but requires an identical seeded random generator in C# and TS)
  Can differ per game. Team decision pending.
- Score direction differs per game (lower-is-better vs. higher-is-better); likely a column on Game.
- Daily puzzle storage: probably one row per game per day holding the seed (and generator version).
- What happens to the hosted service after the semester ends.

## Prisma 7 upgrade: what is known

- Target **Prisma 7.x** (7.10.1 or later in the 7 line), pinned. `npm install prisma` with no
  version now installs a Prisma 8 release candidate, which does not support MySQL.
- Prisma 6 security patches end November 19, 2026. Prisma 7 is supported for 18 months after
  Prisma 8's general availability.
- Upgrading also clears the `deepmerge-ts` npm audit warning.
- Changes required:
  - Project becomes ESM: `"type": "module"` in package.json; relative imports need `.js` extensions.
  - New generator `prisma-client` with an `output` path; import the client from the generated
    folder (gitignore it) instead of `@prisma/client`.
  - `prisma.config.ts` holds the datasource URL, migrations path, and seed command.
  - `.env` is no longer loaded automatically.
  - MySQL driver adapter: `@prisma/adapter-mariadb` plus the `mariadb` driver; PrismaClient is
    constructed with the adapter.
  - Connection pool and SSL defaults differ from v6; configure deliberately for hosted databases.
  - Possible MySQL 8.4 authentication issue over non-SSL connections (public key retrieval).
- Requirements: Node 20.19+ (22 recommended), TypeScript 5.4+.

## Roadmap

1. Upgrade to Prisma 7 (next)
2. Users table with the account design above
3. Registration (validation, password hashing, discriminator assignment)
4. Email verification and password reset (email behind an interface)
5. Login with tokens, plus auth middleware for protected endpoints
6. Hardening: rate limiting on auth endpoints, security headers, CORS for WebGL
7. Dockerfile for the server; production database user and `prisma migrate deploy`
8. Daily puzzles and scores, once the puzzle-generation decision is made

## Working style

The developer is building this step by step to understand every piece: explain each
step and the reasoning behind it, have them run commands themselves, and verify results
before moving on.
