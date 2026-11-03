# GamesHub Backend: Developer Commands

Terminal commands for testing the API and working with the database. Run everything from the
project root. Setup, day-to-day commands, and the API reference are in [README.md](README.md).

The shell helpers use bash/zsh syntax (macOS, Linux, WSL, or Git Bash on Windows).

## Shell helpers

Paste these into the terminal once per session, or add them to `~/.zshrc` (macOS) or
`~/.bashrc` (Linux, WSL, Git Bash) and open a new terminal.

```sh
GAMESHUB_URL="http://localhost:3900"

# Run one SQL query in the database container.
dbq() { docker compose exec db sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysql -u"$MYSQL_USER" "$MYSQL_DATABASE" -e "$1"' sh "$1"; }
# Interactive MySQL prompt.
dbsh() { docker compose exec db sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysql -u"$MYSQL_USER" "$MYSQL_DATABASE"'; }

# POST /auth/register; argument: JSON body.
reg() { curl -s -w ' → %{http_code} (%{time_total}s)\n' -X POST "$GAMESHUB_URL/auth/register" -H 'Content-Type: application/json' -d "$1"; }
# POST /auth/login; argument: JSON body. (Not named "login": that's a system command.)
signin() { curl -s -w ' → %{http_code} (%{time_total}s)\n' -X POST "$GAMESHUB_URL/auth/login" -H 'Content-Type: application/json' -d "$1"; }
# GET /auth/me with the token in $T.
me() { curl -s -w ' → %{http_code}\n' "$GAMESHUB_URL/auth/me" -H "Authorization: Bearer $T"; }
# POST /auth/logout with the token in $T. (Not named "logout": that's a shell builtin.)
signout() { curl -s -w ' → %{http_code}\n' -X POST "$GAMESHUB_URL/auth/logout" -H "Authorization: Bearer $T"; }

# POST /games/:slug/scores with the token in $T; arguments: slug, puzzle date, score, formula version.
submit() { curl -s -w ' → %{http_code}\n' -X POST "$GAMESHUB_URL/games/$1/scores" -H 'Content-Type: application/json' -H "Authorization: Bearer $T" -d "{\"puzzleDate\":\"$2\",\"score\":$3,\"formulaVersion\":$4}"; }

# SHA-256 of a token, to compare with LOWER(HEX(token_hash)) in the database.
tokhash() { printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1; }
```

If `dbq` fails with "Access denied", use
`docker compose exec db mysql -uGamesHub -p GamesHub -e "QUERY"` instead (prompts for `MYSQL_PASSWORD`).

Notes on calling them:

- Pass a JSON body in **single quotes**, so the shell doesn't interpret the double quotes inside it.
- `me`, `signout`, and `submit` read the token from `$T`. Set it with `T='PASTE_TOKEN_HERE'`.
- `submit` puts its third and fourth arguments into the JSON as they are, so `'"500"'` sends a
  string and `1.5` sends a decimal, which is useful for testing validation.
- To see response headers, run the `curl` command from a helper directly with `-i` added.

## Dates

The daily reset is midnight UTC. Puzzle dates are UTC dates.

```sh
D=$(date -u +%F)        # today (UTC)
date -u -v-1d +%F       # yesterday (UTC), macOS
date -u -d yesterday +%F   # yesterday (UTC), Linux / WSL / Git Bash
```

## Example session

```sh
reg '{"email":"test1@example.com","password":"correct-horse-battery","displayName":"Tester"}'
# → 202; the verification email is printed in the npm run dev terminal

signin '{"email":"test1@example.com","password":"correct-horse-battery"}'
# → 200 with "token"; copy it:
T='PASTE_TOKEN_HERE'

me                                   # → 200 with the user
D=$(date -u +%F)
submit sudoku "$D" 500 1             # → 201
submit sudoku "$D" 600 1             # → 409 already_submitted
submit minesweeper "$D" 0 1          # → 201 (a loss)
dbq "SELECT puzzle_date, score, formula_version FROM scores;"

tokhash "$T"
dbq "SELECT LOWER(HEX(token_hash)) FROM sessions;"   # one row matches

signout                              # → 204
me                                   # → 401 invalid_token

dbq "DELETE FROM users WHERE email LIKE '%@example.com';"
```

## Database

```sh
docker compose logs db --tail 5   # check for "ready for connections"
docker compose restart db
```

Common queries:

```sh
dbq "SELECT id, email, display_name, discriminator, email_verified_at FROM users;"
dbq "SELECT user_id, expires_at FROM sessions;"
dbq "SELECT user_id, game_id, puzzle_date, score, formula_version, created_at FROM scores;"
dbq "DELETE FROM users WHERE email LIKE '%@example.com';"   # test cleanup
```

Deleting a user also deletes their verification tokens, sessions, and scores (cascade).
Use `@example.com` addresses for all test accounts so the cleanup query catches them.

Reset everything (deletes all data; also needed after changing `docker/mysql-init/` or `MYSQL_*`
values):

```sh
docker compose down -v
docker compose up -d --build
npx prisma migrate dev
npm run db:seed
```

## Prisma

```sh
npx prisma migrate dev --create-only --name some_change   # create a migration without applying it
npx prisma migrate dev                                     # apply pending migrations
npx prisma generate                                        # regenerate the client after schema changes
npx prisma migrate reset                                   # drop and rebuild the database; then seed
npx prisma migrate status                                  # which migrations are applied
```

- **Never use `prisma db push`.** It bypasses migration files and skips hand-written SQL
  (the discriminator CHECK constraint).
- Never edit a migration that has already been applied; create a new one.
- Prisma 7 never runs `generate` or the seed automatically.
