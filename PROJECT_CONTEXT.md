# GamesHub Server: Project Context

Current state, decisions, and conventions for the GamesHub backend.
Last updated: November 3, 2026.

## What it is

Backend API for a Unity minigame platform (team project, software dev class).
Daily-reset minigames; the backend tracks user accounts and score history.
The CS department chair wants it hosted publicly, so it is being built for real
deployment, not just a class demo. Not shipping until mid-December 2026 at the earliest.

The developer is the only team member building the backend. Teammates run a local instance
for development and testing (setup in README.md) but don't add backend features.

## Current stack

- Node.js 24, Express 5.3, TypeScript 7, **ESM** (`"type": "module"`)
- Prisma **7.10.1, pinned exactly** (`prisma`, `@prisma/client`, `@prisma/adapter-mariadb`),
  `mariadb` driver 3.5.4, zod 4
- MySQL 8.4 in Docker (Docker Desktop on macOS)
- Server port 3900, configurable via `PORT`
- Git repo pushed to a remote; README setup instructions verified from a fresh clone after the Prisma 7 upgrade

## Documentation files

- `README.md` (repo): setup, day-to-day commands, troubleshooting, and the **API reference**
  (every endpoint's request, response, and error codes). Update it whenever an endpoint changes.
- `DEV_COMMANDS.md` (repo): shell helpers (`dbq`, `dbsh`, `reg`, `signin`, `me`, `signout`,
  `submit`, `tokhash`), date commands, an example session, database and Prisma commands.
  Verification procedures below use these helpers.
- `CLIENT_TODO.md` (Unity repo): client-side requirements that come from backend decisions and
  that the server can't enforce (UTC puzzle dates, win score ≥ 1, one attempt per day, ...).
  Add to it whenever a backend decision creates a client obligation.
- `PROJECT_CONTEXT.md` (this file, Claude Project knowledge).

## Project structure

```text
docker/
  Dockerfile           FROM mysql:8.4, COPY --chmod=0644 mysql-init/ into /docker-entrypoint-initdb.d/
  mysql-init/01-grant-dev-privileges.sh   GRANT ALL ON *.* to MYSQL_USER (dev only, for Prisma's shadow DB)
docker-compose.yaml    service "db": build ./docker, port 3306:3306, named volume db-data
prisma.config.ts       Prisma CLI config: schema path, migrations path, seed command, datasource URL
prisma/
  schema.prisma        generator "prisma-client" → ../src/generated/prisma; datasource has no url
  migrations/          init (games), add_users (+ hand-added CHECK constraint),
                       add_email_verification_tokens, add_sessions, add_scores
  seed.ts              idempotent upsert loop over a `games` list; imports `prisma` from src/db.js
src/
  index.ts             Express app and routes; mounts authRouter at /auth, GET /games/:slug,
                       POST /games/:slug/scores
  config.ts            loads .env if present, validates all env vars with zod, exports `config`
  db.ts                single shared PrismaClient, built with the MariaDB adapter
  errors.ts            HttpError, notFound, errorHandler (also maps body-parser errors),
                       describeError, uniqueViolationIndex
  middleware.ts        requireJson (415 for non-JSON bodies)
  auth/
    password.ts        hashPassword / verifyPassword(hash, password) / passwordNeedsRehash
                       (argon2id settings live here)
    tokens.ts          issueToken(ttlMs) → { token, tokenHash, expiresAt }, hashToken; IssuedToken
    verification.ts    createVerificationToken, buildVerificationUrl, VERIFICATION_TOKEN_TTL_HOURS (24)
    sessions.ts        createSessionToken, SESSION_TTL_DAYS (30), authenticate(req, res),
                       userResponse; SessionUser, AuthenticatedSession
    register.ts        POST /auth/register
    login.ts           POST /auth/login
    me.ts              GET /auth/me
    logout.ts          POST /auth/logout
    routes.ts          authRouter (requireJson on register and login)
  email/
    sender.ts          EmailMessage and EmailSender interface (transport only: send({ to, subject, text }))
    console-sender.ts  ConsoleEmailSender: prints the email instead of sending it (development only)
    index.ts           picks the implementation from EMAIL_TRANSPORT; exports the shared `emailSender`
    templates.ts       verificationEmail, registrationAttemptEmail
  games/
    slug.ts            parseSlug (400 invalid_slug); used by both games routes
  scores/
    dates.ts           toUtcDateString / fromUtcDateString ("YYYY-MM-DD" ⇄ Date at midnight UTC)
    response.ts        scoreResponse (shared by submit and the planned history endpoint)
    submit.ts          POST /games/:slug/scores
  generated/prisma/    generated Prisma client (gitignored; run `npx prisma generate`)
.env / .env.example    MYSQL_ROOT_PASSWORD, MYSQL_DATABASE=GamesHub, MYSQL_USER=GamesHub,
                       MYSQL_PASSWORD, DATABASE_URL (mysql://...@127.0.0.1:3306/GamesHub), PORT=3900,
                       DB_ALLOW_PUBLIC_KEY_RETRIEVAL=true (local Docker only, see Prisma 7 notes),
                       EMAIL_TRANSPORT=console, EMAIL_VERIFICATION_URL=http://localhost:3900/verify-email
README.md, DEV_COMMANDS.md
```

npm scripts: `dev` (tsx watch src/index.ts), `typecheck` (tsc --noEmit), `db:seed` (prisma db seed).

tsconfig: `module`/`moduleResolution` are `NodeNext` (deliberately not Prisma's suggested `bundler`:
NodeNext makes tsc enforce Node's real ESM rules, so code that type-checks also runs under Node
after compilation). `include`: `src`, `prisma`, `prisma.config.ts`. Top-level `await` works
(used in `login.ts`).

### Setup order (fresh clone)

`npm install` → copy `.env.example` to `.env` → `docker compose up -d --build` →
`npx prisma generate` → `npx prisma migrate dev` → `npm run db:seed` → `npm run dev`

After pulling: `npm install`, `npx prisma migrate dev`, `npx prisma generate`, `npm run db:seed`.

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
  - `EMAIL_TRANSPORT`: `z.enum(["console"])`, **required, no default**. A default of `console`
    would let a misconfigured production server start and write verification emails (addresses,
    links) to its logs instead of delivering them. Step 4 adds the real transport's value.
    The server logs the active transport at startup.
  - `EMAIL_VERIFICATION_URL`: `z.url({ protocol: /^https?$/ })`, required. Base of the link in
    verification emails; the token is added as a query parameter by `buildVerificationUrl`.
    `refine`: must be `https` unless the host is local (an `http` link would send tokens unencrypted).
    The target path does not exist until step 4.
  - Side effect: `prisma/seed.ts` imports `src/db.js`, which imports `config.ts`, so seeding
    needs the full app config, not just `DATABASE_URL`.
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
Virtual relation field `scores Score[]`.

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
- Virtual relation fields: `emailVerificationTokens`, `sessions`, `scores`.
- Not yet in the table, by design: password-change tracking (step 4, password reset) and
  failed-login counters (step 6).

**EmailVerificationToken** (`email_verification_tokens`), added November 2, 2026:

| Column | Type | Notes |
|---|---|---|
| `id` | Int PK autoincrement | |
| `user_id` | Int, FK → `users.id` | indexed; `ON DELETE CASCADE` |
| `token_hash` | Binary(32), unique | SHA-256 of the token |
| `expires_at` | DateTime(3) | 24 hours after creation |
| `created_at` | DateTime(3) | default now |

- Several tokens per user allowed (resend in step 4); tokens are deleted when used (no `used_at`).
- Created in the same Prisma nested write as the user (one transaction), so a user cannot end up
  without a token.

**Session** (`sessions`), added November 3, 2026 (migration `add_sessions`):

| Column | Type | Notes |
|---|---|---|
| `id` | Int PK autoincrement | |
| `user_id` | Int, FK → `users.id` | indexed; `ON DELETE CASCADE` |
| `token_hash` | Binary(32), unique | SHA-256 of the token |
| `expires_at` | DateTime(3) | 30 days after login, fixed |
| `created_at` | DateTime(3) | default now |

- Login deletes that user's expired sessions in the same transaction that creates the new one.
  Sessions of users who never log in again stay until a cleanup job exists (hardening step).

**Token design (both token tables):** 32 bytes from `crypto.randomBytes`, sent as unpadded base64url
(always 43 characters). Only the SHA-256 hash is stored, so a database leak yields no working
tokens or links. SHA-256, not argon2: 256 bits of entropy makes a slow hash pointless, and an
unsalted hash allows an indexed lookup (`WHERE token_hash = ?`). `BINARY`, not a string column:
the table collation is case-insensitive, so a base64url string column would treat `aB` and `Ab`
as equal. Shared code in `src/auth/tokens.ts`; each token type only supplies its lifetime.

**Score** (`scores`), added November 3, 2026 (migration `add_scores`):

| Column | Type | Notes |
|---|---|---|
| `id` | Int PK autoincrement | never exposed |
| `user_id` | Int, FK → `users.id` | `ON DELETE CASCADE` |
| `game_id` | Int, FK → `games.id` | `ON DELETE RESTRICT` (games are permanent) |
| `puzzle_date` | Date | UTC date of the puzzle, sent by the client |
| `score` | Int **UNSIGNED** | |
| `formula_version` | SmallInt **UNSIGNED** | |
| `created_at` | DateTime(3) | submission time |

- Unique on (`user_id`, `game_id`, `puzzle_date`) = `scores_user_id_game_id_puzzle_date_key`:
  one submission per game per day. The same index serves per-user history queries (user first),
  so there is no separate `user_id` index.
- Unsigned columns (`@db.UnsignedInt`, `@db.UnsignedSmallInt`) instead of a CHECK constraint:
  they reject negatives and are expressible in `schema.prisma`, so no hand-edited migration SQL.
  Verified: inserting `-1` fails with "Out of range value".
- No `updated_at`: scores are never edited.
- Prisma represents `DATE` as a JS `Date` at midnight UTC. Verified that the MariaDB adapter stores
  and returns the date without a timezone shift.
- No leaderboard index yet: design it with the leaderboard query.

## API so far

Full request/response/error reference for clients: README.md. Implementation notes:

- `POST /auth/register`, body `{ email, password, displayName }` → `202 { "status": "check_email" }`
  for both new and existing email (decisions 2, 9, 10 under Registration).
  `400 invalid_email` / `invalid_password` / `invalid_display_name` / `invalid_body`;
  `409 display_name_unavailable` (only when the email is not taken).
- `POST /auth/login`, body `{ email, password }` →
  `200 { token, expiresAt, user: { displayName, discriminator, emailVerified } }`,
  `Cache-Control: no-store`. `400 invalid_body`; `401 invalid_credentials` for both unknown email
  and wrong password.
- `GET /auth/me` (login required) → `200 { user }` (same `user` object as login).
- `POST /auth/logout` (login required) → `204`, deletes the current session (`deleteMany`, so a
  concurrent logout doesn't throw).
- `GET /games/:slug` → `{ slug, name }`; `400 invalid_slug` (`/^[a-z0-9-]{1,64}$/`), `404 game_not_found`.
- `POST /games/:slug/scores` (login required), body `{ puzzleDate, score, formulaVersion }` →
  `201 { score: { game, puzzleDate, score, formulaVersion, submittedAt } }`.
  Check order: 415 → 401 → `invalid_slug` → body fields (`invalid_puzzle_date`, `invalid_score`,
  `invalid_formula_version`, `invalid_body`) → `400 puzzle_date_closed` → `404 game_not_found` →
  `409 already_submitted` (from the unique violation, not a pre-check).
- Protected endpoints: `401 authentication_required` (no header) or `401 invalid_token`
  (malformed, unknown, or expired), always with `WWW-Authenticate: Bearer` (RFC 6750).
- Non-JSON body on a JSON endpoint → `415 unsupported_media_type` (`requireJson` middleware).
- Unknown route → 404 `route_not_found`; unexpected errors → 500 `internal_error` (logged)
- JSON bodies: `express.json({ limit: "16kb" })`, mounted globally before the routes. Largest planned
  body is registration (~3 KB worst case). A route cannot raise the limit while the parser is
  global; switch to per-route parsers if an endpoint ever needs more. Requests whose Content-Type
  is not JSON are not parsed, and in Express 5 `req.body` is then `undefined`.
- Body-parser errors are mapped by their `type` property (a `Map`, not an object literal) to:

  | body-parser `type` | Response |
  |---|---|
  | `entity.parse.failed` (bad JSON, or a top-level non-object/array) | 400 `invalid_json` |
  | `entity.too.large` | 413 `payload_too_large` |
  | `request.size.invalid` | 400 `invalid_body` |
  | `request.aborted` | 400 `request_aborted` |
  | `encoding.unsupported` | 415 `unsupported_encoding` |
  | `charset.unsupported` | 415 `unsupported_charset` |

  Unmapped types (`stream.*`) mean a server bug and stay logged 500s. Mapping matters for security:
  a JSON parse error carries the raw request body (`err.body`), so logging it would write passwords
  to the logs. Messages are fixed strings; body-parser's own messages quote the input.
- `GET /hello` and `GET /boom` are temporary test routes, marked in code; remove before shipping
- `app.listen` callback rethrows startup errors (Express 5 passes them, e.g. EADDRINUSE)

## Conventions

- Every error response: `{ "error": { "code": "...", "message": "..." } }`.
  Clients branch on `code`; `message` is human-readable and may change.
- Routes throw `HttpError(status, code, message)`; the error handler formats all errors.
  HttpErrors are not logged; everything else is logged and returned as a generic 500.
  The handler delegates to `next(err)` if `res.headersSent`.
- Validate input with zod `safeParse` before touching the database. Per-field error codes come
  from the first zod issue's path, via a `FIELD_ERRORS` map (register, score submit).
- Integers from clients: `z.int()` (rejects decimals, numeric strings, and unsafe integers;
  `z.number()` would let MySQL silently round `1.5`).
- JSON-body routes get the `requireJson` middleware; handlers don't check Content-Type themselves.
- **Protected handlers start with `const { user } = await authenticate(req, res);`** (a function,
  not middleware: it returns a typed user without augmenting Express's global types, and needs no
  non-null assertions). `user.id` is for queries only; never put it in a response.
- Response objects come from shared builders: `userResponse` (auth), `scoreResponse` (scores).
  Build responses field by field; never `res.json(row)` (avoids leaking ids, password hashes).
- Dates without a time (puzzle dates) travel as `"YYYY-MM-DD"` UTC strings, converted only in
  `src/scores/dates.ts`. Never send a `DATE` column as a full timestamp: clients converting it to
  local time would show the previous day west of UTC. Points in time are ISO 8601 strings.
- Unique violations: insert first and map the P2002 with `uniqueViolationIndex(err)` (in
  `errors.ts`) by index name; don't check-then-insert (races).
- All environment access goes through `src/config.ts` (app) or `prisma.config.ts` (CLI);
  never read `process.env` elsewhere.
- Relative imports use `.js` extensions (`./db.js`), even in `.ts` files.
- Import the Prisma client only via `src/db.ts`; never construct another PrismaClient.
- Prisma calls that can fail inside handlers use
  ``.catch((err: unknown) => { throw new Error(`... failed: ${describeError(err)}`); })``,
  which keeps the result `const` and typed.
- Send email only via `emailSender` from `src/email/index.ts`. Email content (templates) is built
  outside the sender, so every implementation sends identical content.
- Bytes for Prisma `Bytes` fields are typed `Uint8Array<ArrayBuffer>`, never a bare `Buffer`
  (= `Buffer<ArrayBufferLike>`, which may be shared memory and is rejected by Prisma's types).
  If a Node API returns a loosely typed Buffer, copy it with `new Uint8Array(buf)`; don't cast.
  (`createHash().digest()` is already typed `Buffer<ArrayBuffer>`.)
- Errors from queries involving personal data are never logged raw; log via `describeError`
  (`src/errors.ts`), which gives only the Prisma code or error name. Prisma validation errors print
  query arguments (e.g. emails) and P2002 metadata quotes duplicate values.
- Emails never contain user-supplied text (display names, etc.). Registration can send email to an
  address the requester doesn't own, so anything they typed would reach a stranger's inbox
  (spam/phishing vector). Subjects and bodies are fixed text plus server-generated links.
- Never log request bodies or email addresses (the console email sender is the one development-only
  exception).
- Responses carrying a token: `Cache-Control: no-store`.
- DB tables and columns are snake_case via `@@map` / `@map`; code uses camelCase.
- Seed scripts are idempotent (`upsert`).
- Migrations: create with `--create-only`, review the SQL, then apply. Never edit an applied migration;
  create a new one. Editing before it is applied is fine. Applied migrations are checksummed in
  `_prisma_migrations`.
- **Never use `prisma db push`**: it bypasses migration files and would skip hand-written SQL
  such as the discriminator CHECK constraint.
- Git: track `prisma/migrations/` (including `migration_lock.toml`), `schema.prisma`, `.env.example`;
  never track `src/generated/`, `.env`, `node_modules/`.
- Run commands from the project root.
- Test accounts use `@example.com` addresses; cleanup is `DELETE FROM users WHERE email LIKE '%@example.com'`
  (tokens, sessions, and scores cascade).

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
- **Priority (November 3, 2026):** get a client-usable API to the team first (registration, login,
  score submission, score history), then return to step 4 and the release blockers. Anything
  deferred this way is listed under Release blockers.

### Registration (step 3), decided October 29, 2026

1. **Endpoint:** `POST /auth/register`, JSON body `{ email, password, displayName }`.
2. **Already-registered email:** the response is identical whether or not the email is in use,
   so the endpoint cannot be used to discover accounts. New address: verification email.
   Existing address: an email to its owner saying someone tried to register with it.
   - Consequence: the registration response cannot include the new tag (an existing address
     has no new tag to return). The client gets `displayName` and `discriminator`, as separate
     fields, at login. Login and password reset must use the same kind of generic responses,
     or the leak just moves there (login does: decision 11).
   - Consequence: registration sends email, so the email interface (with its console
     implementation) was built in step 3.
3. **Passwords:** 12–128 characters, length rules only, no composition rules (NIST discourages
   them). Breached-password checking is a candidate for the hardening step.
4. **Display names:** `^[A-Za-z0-9_]{3,16}$`. ASCII only: blocks look-alike characters, and avoids
   JS (UTF-16) vs MySQL character-count mismatches. Can be widened later; narrowing is hard.
5. **Hashing:** argon2id via the `argon2` npm package. Node 24.7+ has a built-in `crypto.argon2()`,
   but it returns only raw bytes; the package also handles salts, the encoded hash format,
   constant-time verification, and rehashing when settings change. Native dependency with
   prebuilt Linux binaries; confirm in the Docker build (step 7).
   - Parameters set explicitly in `src/auth/password.ts`: OWASP baseline (m=19 MiB, t=2, p=1), not
     the package default of 64 MiB, because concurrent hashes hold memory at the same time.
     Raising them later is safe: hashes encode their own parameters, and login rehashes old ones
     (verified). Hashing runs on libuv's thread pool (4 threads by default); revisit together
     with rate limiting.
   - The options object is `as const satisfies argon2.HashOptions`: `satisfies` makes a misspelled
     key a compile error (otherwise argon2 would silently ignore it and use its default).
     Measured ~21 ms per hash on the development Mac.
   - Passwords are NFKC-normalized inside `hashPassword` and `verifyPassword` (NIST SP 800-63B), so the
     same password typed on different devices/keyboards hashes the same. Done before any accounts
     exist; changing it later would break existing non-ASCII passwords.
   - `verifyPassword` does not catch: a malformed stored hash is a bug and should be a logged 500,
     not a "wrong password".
6. **Discriminators:** `crypto.randomInt(1000, 10000)` (unpredictable), try the insert, on a
   unique violation of the tag index retry with a new number, max 5 attempts, then
   `409 display_name_unavailable`. The database decides collisions, so concurrent
   registrations cannot get the same tag.
7. Normalize email (trim + lowercase) before validation and storage; the case-insensitive
   unique index is the safety net, not the main mechanism.
8. **Verification tokens are created at registration**; the verify endpoint is step 4.
9. **Timing must not reveal accounts either.** Both paths do the same expensive work: always hash
   the password, then attempt the insert; a unique violation on `email` is the existing-account
   path. The email is sent after the response is sent (not awaited), so delivery latency can't
   leak; send failures are logged without the recipient address.
10. **Route details:**
    - Content-Type other than JSON → `415 unsupported_media_type` (clearer than a validation error
      about a missing body; catches Unity's form-encoded default).
    - Validation errors are per field, from the first zod issue: `400 invalid_email`,
      `invalid_password`, `invalid_display_name`; anything else (body not an object) `400 invalid_body`.
    - Password length is counted in code points (`[...pw].length`), so an emoji is one character.
    - Success response: `202 { "status": "check_email" }` for both paths. 202 = accepted, outcome not
      reported, which is literally the case.
    - Before returning `409 display_name_unavailable`, check whether the email already exists; if so,
      take the existing-account path. Otherwise a nearly full display name plus an existing email
      could produce 409 or 202 depending on which index MySQL reports first (an enumeration leak).

### Login and sessions (step 5), decided and built November 3, 2026

11. **Login:** `POST /auth/login`. Unknown email and wrong password both give `401 invalid_credentials`.
    With no account, the handler still runs an argon2 verify against `DUMMY_HASH` (created at
    startup with top-level `await`, current settings), so both paths cost one verify.
    No length/format checks on login: the registration rules can't be matched by invalid input
    anyway, duplicating them would need syncing, and the 16 KB body limit bounds input size.
12. **Unverified accounts can log in** (for now). Reason: gating login on verification would pull
    all of step 4 into the critical path. Reversible: `email_verified_at` is recorded, so the gate is
    one check in the login handler. Consequence: address squatting stays possible; **must be decided
    before public hosting** (see Release blockers).
13. **Sessions:** opaque random tokens, hashed in `sessions`, sent as `Authorization: Bearer <token>`.
    Revocable (logout deletes the row), same pattern as verification tokens. JWTs rejected: they
    can't be revoked without a table anyway. Cookies rejected: third-party cookies in WebGL/itch.io.
14. **Fixed 30-day lifetime**, not sliding. Sliding expiry would write on every authenticated request
    (or need throttling logic); a monthly re-login is acceptable for a daily game. Can be added
    later with one column, no data loss.
15. **Rehash on login** when `passwordNeedsRehash`: conditional `updateMany` on
    (`id`, old `passwordHash`), so a concurrent password reset is never overwritten. A failed rehash
    is logged and doesn't fail the login.
16. **`authenticate`:** checks the header format (`/^Bearer [A-Za-z0-9_-]{43}$/i`, scheme
    case-insensitive) before any database lookup; missing header and invalid token have separate
    codes (debugging aid; the client handles both the same way).

### Scores, decided and built November 3, 2026

17. **Scores are client-reported** for the first version (answers the puzzle-generation question as
    option 1 for now): Unity generates each day's puzzle and computes the score. Scores are fakeable;
    accepted for a class build. Server-side checks can be added per game later.
18. **Score values:** every game's formula yields an integer; **higher is always better** (no
    per-game direction column). Time-based games convert completion time into a score.
    No formula produces negatives; scores are expected to stay below ~10,000. API sanity limit
    `MAX_SCORE` = 1,000,000 lives in code (policy; a DB limit would need a migration to change).
19. **One attempt per day per game, same puzzle for everyone, daily reset at midnight UTC.**
    The server enforces one *submission*; one *attempt* is the client's job (replaying offline and
    submitting the best run can't be prevented with client-reported scores).
20. **The client sends `puzzleDate`.** Accepted: today's UTC date, or yesterday's during a 1-hour
    grace period after midnight UTC (implemented as the UTC dates of *now* and *now − 1 h*), so a game
    started before midnight still counts. Tomorrow is always rejected.
21. **Losses are submitted with score 0** ("wall of shame"). Requirement on the client: a completed
    game must always score ≥ 1, or wins and losses become indistinguishable (in CLIENT_TODO.md). If a
    game can't guarantee it, add a `won` column.
22. **`formula_version`** on each score (client-sent, starts at 1, bump when a formula changes), so
    scores from different formulas are never compared. Leaderboards will filter by version; a
    per-game current version (column on `games`) can be added then.
23. **Ties:** equal scores share a rank and the next rank is skipped (1, 2, 2, 4); within a tie,
    earlier `created_at` is listed first (display order only). No tiebreak data stored.
24. **Account deletion cascades to scores** (resolves the earlier open question). Keeping scores
    detached later would mean making `user_id` nullable: an ordinary migration.

### Unique violations (P2002) with the MariaDB adapter (measured on 7.10.1)

- Unique violations are `PrismaClientKnownRequestError` with code `P2002`; `meta.target` is absent.
- The index name is at `meta.driverAdapterError.cause.constraint.index`, read by
  `uniqueViolationIndex` (`src/errors.ts`; returns the name, `"unrecognized"` for an unknown P2002
  shape, or `undefined` for other errors). Known names: `users_email_key`,
  `users_display_name_discriminator_key`, `scores_user_id_game_id_puzzle_date_key`.
- `meta.driverAdapterError.cause.originalMessage` is MySQL's text and **contains the duplicate value**,
  e.g. the email address. Never log these errors raw.
- The shape is adapter-specific and undocumented; re-run the registration and score tests after any
  Prisma upgrade. Index names come from Prisma's default naming, so renaming fields renames them.
- Confirmed: the email unique index is case-insensitive.

## Open questions

- Where the verification link points (an API endpoint or a page); decide in step 4. Points to weigh:
  - Email security scanners and link previewers open links automatically. A link that verifies on
    `GET` can be triggered without the user clicking; for password reset it would consume the token.
    A page with a button that sends a `POST` avoids this.
  - A token in the query string ends up in server access logs, browser history, and `Referer`
    headers; a token in the URL fragment (`#token=...`) is never sent to a server, but then a page
    must read it with JavaScript. `buildVerificationUrl` is the one place to change.
- Address squatting: someone can register a stranger's address. The owner then can't register
  (they get the "already registered" email) and doesn't know the password. Likely answer for step 4:
  password reset works for unverified accounts and marks the email verified (it proves mailbox
  ownership), and the "someone tried to register" email points to password reset. Also decide
  whether unverified accounts expire, and whether unverified accounts keep being allowed to log in
  (decision 12).
- Leaderboard design (query, index, version filtering) when a leaderboard screen is needed.
- Server-side score validation per game (puzzle generation options 2 or 3), if ever: would need
  the generator in TypeScript and probably a daily-puzzle table (seed + generator version).
- What happens to the hosted service after the semester ends.

## Release blockers (before public hosting)

Deferred by the November 3 priority change; none blocks client development against a local server.

- Step 4: email verification endpoint, password reset, real email sender; address squatting and
  the unverified-login decision (12).
- Step 6: rate limiting on auth endpoints (login is open to password guessing until then), CORS
  for WebGL, security headers.
- Step 7: server Docker image, production database user, TLS to the database, `migrate deploy`.
- Remove `GET /hello` and `GET /boom`.

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

## Verification procedures (other)

All use the helpers in DEV_COMMANDS.md. The `npm run dev` terminal must print nothing except
emails from the console sender; any other output means an error reached the logged 500 path.
Clean up with the `@example.com` delete afterwards.

- **Body parsing:** POST to `/auth/register` with `-H 'Content-Type: application/json'`
  (the parser runs before routing, so this works for any path). Expected: `-d '{bad'` → 400
  `invalid_json`; `'"hello"'` → 400 `invalid_json`; a ~20 KB body → 413 `payload_too_large`;
  `charset=latin1` → 415 `unsupported_charset`; `Content-Encoding: bogus` → 415
  `unsupported_encoding`; Content-Type `text/plain` → 415 `unsupported_media_type`.
- **Registration** (`reg`):
  - New email → 202 + verification email printed; same email with different case/spaces and another
    name → identical 202 + "someone tried" email, with similar response time.
  - Bad email / short password / bad display name / `[]` / `text/plain` → 400 `invalid_email`,
    `invalid_password`, `invalid_display_name`, `invalid_body`, 415.
  - DB: one user and one token; `LOWER(HEX(token_hash))` equals `tokhash TOKEN`.
  - 409 path: temporarily fix the discriminator at `1000`. Register a new email with name `Alice`
    (creates `Alice#1000`, 202), then another new email with `Alice` → 409, then an existing email
    with `Alice` → 202 + "someone tried" email. Revert afterwards.
- **Login** (`signin`): correct → 200, `expiresAt` 30 days out, `emailVerified:false`; uppercase
  email with spaces → 200; wrong password and unknown email → identical 401 `invalid_credentials`
  with similar times; `[]` → 400 `invalid_body`; `text/plain` → 415; `-i` shows
  `Cache-Control: no-store`; session token hash matches a row.
  Rehash: set `timeCost: 3`, log in, hash contains `t=3`; revert to 2, log in, hash back to `t=2`.
- **Sessions** (`me`, `signout`): valid token → 200 without `id`; no header → 401
  `authentication_required` with `WWW-Authenticate: Bearer`; `Bearer abc` and a one-character change
  → 401 `invalid_token`; lowercase `bearer` → 200; expire via
  `UPDATE sessions SET expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 DAY` → 401, and the next login
  deletes the expired row; logout → 204, then `me` and a second logout → 401.
- **Scores** (`submit`, `D=$(date -u +%F)`): today → 201 with `puzzleDate` = `$D`; again → 409
  `already_submitted`; score 0 → 201; scores `-1`, `1.5`, `1000001`, `'"500"'` → `invalid_score`;
  version 0 → `invalid_formula_version`; `2026-13-01` → `invalid_puzzle_date`; yesterday and
  tomorrow → `puzzle_date_closed` (yesterday is accepted during the first hour after midnight UTC);
  slug `nope` → 404, `Bad_Slug` → `invalid_slug`; empty `$T` → 401; DB `puzzle_date` equals `$D`.
  Grace window: temporarily set `GRACE_PERIOD_MS` to 48 h, yesterday → 201; revert.
- **Schema constraints:** raw inserts into `scores` with score `-1` fail (out of range); a duplicate
  (user, game, date) fails on the unique key; deleting a game with scores fails (RESTRICT);
  deleting the user cascades.
- **Email config:** removing `EMAIL_TRANSPORT`, or setting an unknown value, stops the server
  at startup with a zod error.

## Roadmap

1. ~~Upgrade to Prisma 7~~ (done October 29, 2026)
2. ~~Users table with the account design above~~ (done October 29, 2026)
3. ~~Registration~~ (done November 2, 2026)
4. ~~Login with tokens, `/auth/me`, logout~~ (done November 3, 2026; was step 5)
5. Scores (was step 8, pulled forward):
   - ~~`scores` table~~, ~~`POST /games/:slug/scores`~~ (done November 3, 2026)
   - **Next:** score history for the logged-in player (`scoreResponse` is ready for it; the unique
     index serves the query). Then client work begins.
   - Later: leaderboards (index design, ranking per decision 23, version filtering)
6. Email verification endpoint and password reset (real email sender behind the interface);
   settle the open questions on links, address squatting, and unverified login first
7. Hardening: rate limiting on auth endpoints, security headers, CORS for WebGL;
   breached-password check; cleanup of expired sessions and tokens. Pull CORS forward if the
   WebGL client needs testing before then.
8. Dockerfile for the server (placeholder `DATABASE_URL` for `prisma generate`; confirm argon2's
   native binary works in the image); production database user, TLS to the database,
   and `prisma migrate deploy`

## Unity integration

Client-side obligations are tracked in CLIENT_TODO.md (Unity repo). Background:

- **The Editor and WebGL builds behave differently.** In the Editor, Unity makes the request itself;
  in WebGL the browser makes it and enforces CORS and mixed-content rules. Local development uses
  the Editor against a local server, which needs neither. Test the WebGL build against the hosted API.
- **CORS:** a JSON `POST` triggers a preflight `OPTIONS`, which currently gets 404. The allowed
  origin must be the page that runs the game; on itch.io that is likely an itch.zone domain, not
  itch.io. Confirm by logging the `Origin` header from the real build.
- **HTTPS:** an HTTPS page cannot call an `http://` API, so a WebGL build can only use the hosted API.
- **Content-Type:** older `UnityWebRequest.Post(url, string)` sends form-encoded data, which gets
  `415`. The `UploadHandlerRaw` pattern (with `Content-Type`, `Authorization`, and `timeout = 15`)
  is in README.md.
- **Errors:** on 4xx, `req.result` is `ProtocolError` but the body is still readable; parse
  `{ error: { code, message } }` and branch on `code`. Network failures have no body.
- Validate in Unity for quick feedback, but the server is authoritative.
- Registration success is a generic "check your email" response with no tag; the screen should
  say exactly that, plus the guest-score warning.
- The game draws on a canvas, so browser password managers can't autofill or save passwords.
- **Session tokens:** stored by the game (WebGL `PlayerPrefs` is backed by IndexedDB), sent as
  `Authorization: Bearer`. On any 401, discard and show login; on logout, discard regardless of the
  response. `GET /auth/me` checks a stored token at startup.
- **Puzzle dates:** Unity picks the daily puzzle by the UTC date and submits that date.

## Working style

The developer is building this step by step to understand every piece: explain each
step and the reasoning behind it, have them run commands themselves, and verify results
before moving on. To save usage, the developer pastes command output only when it doesn't
match what was expected.

- Claude can't see the repository; only this file is in the Project's knowledge. Ask the developer
  to paste the current version of any file before changing it, rather than writing code against an
  assumed version.
- New work is split into numbered pieces, each with its checks; the developer confirms when a piece's
  checks pass.
- At the end of a session, Claude sends full updated versions of this file and any other changed docs.
