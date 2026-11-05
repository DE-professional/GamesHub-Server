# GamesHub Server

Backend API for the GamesHub minigame platform. It stores the list of games, player accounts,
and each player's daily scores.

Built with Node.js, Express 5, TypeScript, Prisma 7, and MySQL 8.4 (running in Docker).

## Prerequisites

- **Node.js 24 or newer**. Check with `node --version`.
- **Docker Desktop**, installed and running.
- **Git**

## First-time setup

Run every command from the project root (the folder containing `package.json`).

### 1. Clone and install

```bash
git clone <repo-url>
cd GamesHub-Server
npm install
```

### 2. Create your environment file

```bash
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env`.

The values in `.env.example` work as-is for local development. If you change a
password, change it in **both** `MYSQL_PASSWORD` and `DATABASE_URL`. If a password
contains `@`, `:`, `/`, `#`, or `?`, percent-encode those characters in
`DATABASE_URL` (for example, `@` becomes `%40`).

Keep `DB_ALLOW_PUBLIC_KEY_RETRIEVAL=true` for the local Docker database. MySQL 8.4's default
login method needs it on unencrypted connections whenever MySQL's login cache is empty, which
happens after every database restart. Without it, the server fails with
"Pool failed to retrieve a connection" after the database restarts. The server refuses to start
with this setting for any database that isn't on your own machine.

`.env` is gitignored. Never commit it.

### 3. Start the database

```bash
docker compose up -d --build
docker compose logs db
```

The first start takes a minute while MySQL initializes. Wait until the logs show
`ready for connections` with `port: 3306`. (An earlier "ready for connections"
line with `port: 0` is MySQL's temporary setup server; keep waiting.)

### 4. Generate the Prisma client, create the tables, and add starting data

```bash
npx prisma generate
npx prisma migrate dev
npm run db:seed
```

`generate` creates the database client code in `src/generated/` (gitignored).
`migrate dev` applies every migration in `prisma/migrations/`. `db:seed` adds the games list.
All three are safe to re-run. Prisma 7 never runs one of them for you, so run each explicitly.

### 5. Start the server

```bash
npm run dev
```

The server listens on `http://localhost:3900` and restarts automatically when
you save a file. Check it works:

```bash
curl -i http://localhost:3900/games/minesweeper
```

You should get `200 OK` with `{"slug":"minesweeper","name":"Minesweeper"}`.

For testing the API from the terminal (shell helpers, database queries), see
[DEV_COMMANDS.md](DEV_COMMANDS.md).

## Day-to-day

**Starting work:** `docker compose up -d`, then `npm run dev`.

**After pulling changes:** run all of these. Each is harmless when nothing changed.

```bash
npm install
npx prisma migrate dev
npx prisma generate
npm run db:seed
```

Skipping `prisma generate` after a schema change makes the server fail with confusing type or
"unknown field" errors.

**Stopping:** Ctrl+C stops the server. `docker compose stop` stops the database
and keeps its data.

**Starting over with a clean database:** `npx prisma migrate reset` deletes all
data and reapplies the migrations. Then run `npm run db:seed`; Prisma 7 no longer seeds
automatically after a reset.

## API

Base URL (local): `http://localhost:3900`

All request bodies are JSON and must be sent with `Content-Type: application/json`;
anything else gets `415 unsupported_media_type`.

### Errors

Every error response has the same shape:

```json
{ "error": { "code": "game_not_found", "message": "No game with slug \"nope\"" } }
```

Client code should branch on `code`, which never changes. `message` is for
people and may be reworded. Codes any endpoint can return:

| Status | Code | Meaning |
|---|---|---|
| 400 | `invalid_json` | Body isn't valid JSON, or isn't an object or array |
| 413 | `payload_too_large` | Body over 16 KB |
| 415 | `unsupported_media_type` | Endpoint needs a JSON body and the Content-Type isn't JSON |
| 404 | `route_not_found` | No such endpoint |
| 500 | `internal_error` | Server bug; details are in the server log |

### Authentication

Endpoints marked **Requires login** need the token from `POST /auth/login` in a header:

```text
Authorization: Bearer <token>
```

They return these errors when it's missing or bad:

| Status | Code | Meaning |
|---|---|---|
| 401 | `authentication_required` | No `Authorization` header |
| 401 | `invalid_token` | Token is malformed, unknown, expired, or logged out |

On either one, the client should discard its stored token and show the login screen.
Sessions last 30 days from login; using them doesn't extend them.

### `POST /auth/register`

Creates an account and sends a verification email. Body:

```json
{ "email": "player@example.com", "password": "at least twelve chars", "displayName": "Player_1" }
```

- `email`: a valid address. Case and surrounding spaces are ignored.
- `password`: 12–128 characters.
- `displayName`: 3–16 letters, digits, or underscores. A random 4-digit discriminator is
  added to it (`Player_1#4821`).

| Status | Code | Meaning |
|---|---|---|
| 202 | | `{ "status": "check_email" }` |
| 400 | `invalid_email`, `invalid_password`, `invalid_display_name` | That field is invalid |
| 400 | `invalid_body` | Body isn't an object with the three fields |
| 409 | `display_name_unavailable` | Too many players have this display name; choose another |

The `202` response is the same whether or not the email already has an account, so the
response never reveals who is registered. (An existing account's owner gets an email
instead.) The response contains no tag: the player's full tag is returned at login.

### `POST /auth/login`

Body:

```json
{ "email": "player@example.com", "password": "at least twelve chars" }
```

Response `200`:

```json
{
  "token": "43 characters",
  "expiresAt": "2026-12-03T17:00:00.000Z",
  "user": { "displayName": "Player_1", "discriminator": 4821, "emailVerified": false }
}
```

| Status | Code | Meaning |
|---|---|---|
| 200 | | Logged in |
| 400 | `invalid_body` | Body isn't an object with `email` and `password` strings |
| 401 | `invalid_credentials` | Wrong email or password (deliberately not told apart) |

Unverified accounts can log in for now. Display the tag as `displayName#discriminator`.

### `GET /auth/me`

**Requires login.** Returns the logged-in player, in the same shape as login's `user`:

```json
{ "user": { "displayName": "Player_1", "discriminator": 4821, "emailVerified": false } }
```

Use it to check whether a stored token is still valid when the game starts.

### `POST /auth/logout`

**Requires login.** Ends the current session. Response `204` with no body. The client
should discard its token whatever the response is.

### `GET /games/:slug`

Returns one game.

```json
{ "slug": "minesweeper", "name": "Minesweeper" }
```

| Status | Code | Meaning |
|---|---|---|
| 200 | | Game found |
| 400 | `invalid_slug` | Slug isn't 1–64 lowercase letters, digits, or hyphens |
| 404 | `game_not_found` | No game has this slug |

### `POST /games/:slug/scores`

**Requires login.** Submits the player's score for a day's puzzle. One score per game per day.

```json
{ "puzzleDate": "2026-11-03", "score": 500, "formulaVersion": 1 }
```

- `puzzleDate`: the UTC date of the puzzle that was played (`YYYY-MM-DD`). Accepted only for
  today's UTC date, or for yesterday's during the first hour after midnight UTC (so a game
  started just before midnight still counts).
- `score`: an integer from 0 to 1,000,000. Higher is better. A loss is submitted as `0`.
- `formulaVersion`: an integer from 1 to 65,535. The version of the game's score formula,
  starting at 1. Increase it whenever the formula changes.

Response `201`:

```json
{
  "score": {
    "game": "sudoku",
    "puzzleDate": "2026-11-03",
    "score": 500,
    "formulaVersion": 1,
    "submittedAt": "2026-11-03T17:42:10.123Z"
  }
}
```

| Status | Code | Meaning |
|---|---|---|
| 201 | | Score stored |
| 400 | `invalid_slug` | Slug isn't 1–64 lowercase letters, digits, or hyphens |
| 400 | `invalid_puzzle_date`, `invalid_score`, `invalid_formula_version` | That field is invalid |
| 400 | `invalid_body` | Body isn't an object with the three fields |
| 400 | `puzzle_date_closed` | That day's puzzle no longer (or not yet) accepts scores |
| 404 | `game_not_found` | No game has this slug |
| 409 | `already_submitted` | A score already exists for this game and day |

`puzzleDate` is a calendar date, not a point in time: never convert it to local time.

### `GET /games/:slug/scores/me`

**Requires login.** Returns the logged-in player's scores for one game, newest puzzle date first,
one page at a time.

Query parameters, both optional:

- `limit`: an integer from 1 to 100; default 30. Scores per page.
- `before`: a date (`YYYY-MM-DD`). Only scores with an earlier puzzle date are returned. Pass the
  previous page's `nextBefore` here to get the next (older) page.

Response `200`:

```json
{
  "scores": [
    {
      "game": "sudoku",
      "puzzleDate": "2026-11-03",
      "score": 500,
      "formulaVersion": 1,
      "submittedAt": "2026-11-03T17:42:10.123Z"
    }
  ],
  "nextBefore": "2026-11-03"
}
```

- Each item has the same shape as the `score` object from `POST /games/:slug/scores`.
- `nextBefore` is the oldest `puzzleDate` on the page, or `null` when there are no older scores. To load the whole history, request pages
  until it is `null`.
- A game the player has never played returns `{ "scores": [], "nextBefore": null }`.
- Scores from every formula version are included. Don't compare or sort scores across versions.
- `?limit=1` returns only the most recent score: if its `puzzleDate` is today's UTC date, today's
  puzzle has already been played.

| Status | Code | Meaning |
|---|---|---|
| 200 | | Scores returned (possibly none) |
| 400 | `invalid_slug` | Slug isn't 1–64 lowercase letters, digits, or hyphens |
| 400 | `invalid_limit` | `limit` isn't an integer from 1 to 100 |
| 400 | `invalid_before` | `before` isn't a valid `YYYY-MM-DD` date |
| 404 | `game_not_found` | No game has this slug |

### Games

Each Unity game identifies itself by its **slug**. Slugs are permanent: never
change one after a game uses it.

| Slug | Name |
|---|---|
| `minesweeper` | Minesweeper |
| `sudoku` | Sudoku |
| `price-is-nice` | Price Is Nice |
| `blackjack` | Blackjack |
| `runner` | Runner |

To add a game, add an entry to the `games` list in `prisma/seed.ts`, run
`npm run db:seed`, and add it to this table.

## Calling the API from Unity

- Use `UnityWebRequest`. Check `request.result`: `ConnectionError` means the
  server couldn't be reached; `ProtocolError` means it answered with an error
  status, and the body contains the error JSON above.
- Send JSON bodies with `Content-Type: application/json`. Older
  `UnityWebRequest.Post(url, string)` sends form data instead, which gets `415`.
  This works in every Unity version:

  ```csharp
  using var req = new UnityWebRequest(url, "POST");
  req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
  req.downloadHandler = new DownloadHandlerBuffer();
  req.SetRequestHeader("Content-Type", "application/json");
  req.SetRequestHeader("Authorization", "Bearer " + token); // endpoints that require login
  req.timeout = 15; // seconds; the default of 0 waits forever
  yield return req.SendWebRequest();
  ```

- `JsonUtility` needs `[Serializable]` classes with **public fields** (not
  properties) whose names exactly match the JSON keys. Mismatched names fail
  silently and leave fields empty.
- If Unity reports **"Insecure connection not allowed"**, set
  *Project Settings → Player → Other Settings → Allow downloads over HTTP* to
  *Allowed in Development Builds*.
- Test in the Unity Editor against a local server. A WebGL build runs in a browser, which
  requires HTTPS and CORS; those come with the hosted server.

## Changing the database schema

1. Edit `prisma/schema.prisma`.
2. Run `npx prisma migrate dev --create-only --name short_description_of_change`.
3. Read the generated `migration.sql` in the new `prisma/migrations/` folder and check it does
   only what you intended.
4. Run `npx prisma migrate dev` to apply it, then `npx prisma generate`.
5. Commit the schema **and** the new migration folder.

Never edit or delete a migration that has been committed. Make a new one.
Never use `npx prisma db push`: it skips the migration files, including hand-written SQL in them.

## Project layout

```text
docker/
  Dockerfile           MySQL image with the setup script built in
  mysql-init/          runs once when the database is first created (dev only)
docker-compose.yaml    the MySQL container
prisma.config.ts       Prisma command-line settings
prisma/
  schema.prisma        tables and relations
  migrations/          SQL generated from the schema (commit these)
  seed.ts              starting data: the games list
src/
  index.ts             the Express app and routes
  config.ts            reads and checks the environment variables
  db.ts                the shared Prisma client
  errors.ts            HttpError, the error-response handler, safe error logging
  middleware.ts        requireJson
  auth/                registration, login, sessions, passwords, tokens
  email/               email sending (prints to the console in development) and templates
  games/               game slug validation and lookup
  scores/              score submission and history
.env.example           template for your .env
DEV_COMMANDS.md        terminal commands for testing and database work
```

## Troubleshooting

**`ports are not available ... 3306 ... address already in use`**
Another MySQL is running on your machine. Find it with
`sudo lsof -iTCP:3306 -sTCP:LISTEN` (macOS/Linux; `sudo` is required to see it)
or `netstat -ano | findstr :3306` (Windows). Stop it, or change the host port: in
`docker-compose.yaml`, change `"3306:3306"` to `"3307:3306"`, and change the port
in `DATABASE_URL` to `3307`.

**`P3014` / "could not create the shadow database"**
The setup script in `docker/mysql-init/` didn't run. It only runs when the
database volume is first created. Recreate it (this deletes local data):

```bash
docker compose down -v
docker compose up -d --build
```

**`Access denied for user` after editing `.env`**
MySQL reads the `MYSQL_*` variables only when the volume is first created, so
later changes are ignored. Recreate the volume as above. Also check that the
password in `DATABASE_URL` matches `MYSQL_PASSWORD`.

**"Pool failed to retrieve a connection" after restarting the database**
`DB_ALLOW_PUBLIC_KEY_RETRIEVAL` is missing or not `true` in `.env`. See step 2.

**The server won't start and prints a validation error about an environment variable**
A variable in `.env` is missing or invalid. Compare your `.env` with `.env.example`; new
variables are added there when features need them.

**Edited a file in `docker/` and nothing changed**
Those files are built into the image. Rebuild with `docker compose up -d --build`.
Setup scripts additionally need a fresh volume (`docker compose down -v` first).

**`Can't reach database server`**
The container isn't running or isn't ready yet. Check `docker compose ps` and
`docker compose logs db`.

**Docker isn't doing what `docker-compose.yaml` says**
Run `docker compose config` to see the configuration Docker actually resolved.
