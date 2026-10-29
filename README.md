# GamesHub Server

Backend API for the GamesHub minigame platform. It stores the list of games and,
as it grows, user profiles and score history.

Built with Node.js, Express 5, TypeScript, Prisma 6, and MySQL 8.4 (running in Docker).

## Prerequisites

- **Node.js 20 or newer** (22 LTS recommended). Check with `node --version`.
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

npm will report a high-severity vulnerability in `deepmerge-ts`. It is a known
issue in the Prisma 6 command-line tool only, not in anything the server runs.
**Do not run `npm audit fix --force`**: it upgrades Prisma to a new major version
and breaks the setup.

### 2. Create your environment file

```bash
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env`.

The values in `.env.example` work as-is for local development. If you change a
password, change it in **both** `MYSQL_PASSWORD` and `DATABASE_URL`. If a password
contains `@`, `:`, `/`, `#`, or `?`, percent-encode those characters in
`DATABASE_URL` (for example, `@` becomes `%40`).

`.env` is gitignored. Never commit it.

### 3. Start the database

```bash
docker compose up -d --build
docker compose logs db
```

The first start takes a minute while MySQL initializes. Wait until the logs show
`ready for connections` with `port: 3306`. (An earlier "ready for connections"
line with `port: 0` is MySQL's temporary setup server; keep waiting.)

### 4. Create the tables and add starting data

```bash
npx prisma migrate dev
npx prisma db seed
```

`migrate dev` applies every migration in `prisma/migrations/` and generates the
Prisma client. `db seed` adds the games list. Both are safe to re-run.

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

## Day-to-day

**Starting work:** `docker compose up -d`, then `npm run dev`.

**After pulling changes:** run `npm install` (if `package.json` changed) and
`npx prisma migrate dev` (if anything in `prisma/` changed). Running both every
time is harmless.

**Stopping:** Ctrl+C stops the server. `docker compose down` stops the database
and keeps its data.

**Starting over with a clean database:** `npx prisma migrate reset` deletes all
data, reapplies the migrations, and reruns the seed.

## API

Base URL (local): `http://localhost:3900`

### `GET /games/:slug`

Returns one game.

```json
{ "slug": "minesweeper", "name": "Minesweeper" }
```

| Status | Code | Meaning |
|---|---|---|
| 200 | | Game found |
| 400 | `invalid_slug` | Slug isn't 1–64 lowercase letters, digits, or dashes |
| 404 | `game_not_found` | No game has this slug |

### Errors

Every error response has the same shape:

```json
{ "error": { "code": "game_not_found", "message": "No game with slug \"nope\"" } }
```

Client code should branch on `code`, which never changes. `message` is for
people and may be reworded. Other codes any endpoint can return:
`route_not_found` (404) and `internal_error` (500).

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
`npx prisma db seed`, and add it to this table.

## Calling the API from Unity

- Use `UnityWebRequest`. Check `request.result`: `ConnectionError` means the
  server couldn't be reached; `ProtocolError` means it answered with an error
  status, and the body contains the error JSON above.
- `JsonUtility` needs `[Serializable]` classes with **public fields** (not
  properties) whose names exactly match the JSON keys. Mismatched names fail
  silently and leave fields empty.
- If Unity reports **"Insecure connection not allowed"**, set
  *Project Settings → Player → Other Settings → Allow downloads over HTTP* to
  *Allowed in Development Builds*.

## Changing the database schema

1. Edit `prisma/schema.prisma`.
2. Run `npx prisma migrate dev --name short_description_of_change`.
3. Commit the schema **and** the new folder in `prisma/migrations/`.

Never edit or delete a migration that has been committed. Make a new one.

## Project layout

```text
docker/
  Dockerfile           MySQL image with the setup script built in
  mysql-init/          runs once when the database is first created (dev only)
docker-compose.yaml    the MySQL container
prisma/
  schema.prisma        tables and relations
  migrations/          SQL generated from the schema (commit these)
  seed.ts              starting data: the games list
src/
  index.ts             the Express app and routes
  db.ts                the shared Prisma client
  errors.ts            HttpError and the error-response handler
.env.example           template for your .env
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

**Edited a file in `docker/` and nothing changed**
Those files are built into the image. Rebuild with `docker compose up -d --build`.
Setup scripts additionally need a fresh volume (`docker compose down -v` first).

**`Can't reach database server`**
The container isn't running or isn't ready yet. Check `docker compose ps` and
`docker compose logs db`.

**Docker isn't doing what `docker-compose.yaml` says**
Run `docker compose config` to see the configuration Docker actually resolved.
