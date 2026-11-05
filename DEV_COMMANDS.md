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

# Shared password of all @example.com test accounts.
TEST_PASSWORD='correct-horse-battery'
# Log in a test account and store its token in $T; argument: the part before @example.com.
loginas() {
    local res code body token
    res=$(curl -s -w '\n%{http_code}' -X POST "$GAMESHUB_URL/auth/login" -H 'Content-Type: application/json' \
        -d "{\"email\":\"$1@example.com\",\"password\":\"$TEST_PASSWORD\"}")
    code=${res##*$'\n'}
    body=${res%$'\n'*}
    if [ "$code" != 200 ]; then printf '%s → %s\n' "$body" "$code"; return 1; fi
    token=$(printf '%s' "$body" | grep -o '"token":"[A-Za-z0-9_-]\{43\}"' | cut -d'"' -f4)
    if [ -z "$token" ]; then echo "No token in the login response: $body"; return 1; fi
    T=$token
    echo "Logged in as $1@example.com; token in \$T"
}
# GET /auth/me with the token in $T.
me() { curl -s -w ' → %{http_code}\n' "$GAMESHUB_URL/auth/me" -H "Authorization: Bearer $T"; }
# POST /auth/logout with the token in $T. (Not named "logout": that's a shell builtin.)
signout() { curl -s -w ' → %{http_code}\n' -X POST "$GAMESHUB_URL/auth/logout" -H "Authorization: Bearer $T"; }

# POST /games/:slug/scores with the token in $T; arguments: slug, puzzle date, score, formula version.
submit() { curl -s -w ' → %{http_code}\n' -X POST "$GAMESHUB_URL/games/$1/scores" -H 'Content-Type: application/json' -H "Authorization: Bearer $T" -d "{\"puzzleDate\":\"$2\",\"score\":$3,\"formulaVersion\":$4}"; }
# GET /games/:slug/scores/me with the token in $T; arguments: slug, optional query string.
myscores() { curl -s -w ' → %{http_code}\n' "$GAMESHUB_URL/games/$1/scores/me${2:+?$2}" -H "Authorization: Bearer $T"; }

# SHA-256 of a token, to compare with LOWER(HEX(token_hash)) in the database.
tokhash() { printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1; }
```

If `dbq` fails with "Access denied", use
`docker compose exec db mysql -uGamesHub -p GamesHub -e "QUERY"` instead (prompts for `MYSQL_PASSWORD`).

Notes on calling them:

- Pass a JSON body in **single quotes**, so the shell doesn't interpret the double quotes inside it.
- `me`, `signout`, `submit`, and `myscores` read the token from `$T`. `loginas test1` logs in
  `test1@example.com` with `$TEST_PASSWORD` and sets `$T`; switching players is another `loginas`.
  To set it by hand: `T='PASTE_TOKEN_HERE'`.
- `loginas` only works for accounts registered with `$TEST_PASSWORD`. A failed login prints the
  error and status and leaves `$T` unchanged. Use `signin` to see the raw login response.
- `loginas` must stay a shell function (a script can't set variables in your terminal), and its
  output must not be piped: in bash a piped function runs in a subshell, so `$T` would be lost.
- `myscores` takes the query string without the `?`. Quote it, because `&` otherwise means "run in
  the background": `myscores sudoku 'limit=30&before=2026-10-01'`. Use double quotes when it
  contains a variable: `myscores sudoku "limit=1&before=$D"`.
- `submit` puts its third and fourth arguments into the JSON as they are, so `'"500"'` sends a
  string and `1.5` sends a decimal, which is useful for testing validation.
- To see response headers, run the `curl` command from a helper directly with `-i` added.

## Dates

The daily reset is midnight UTC. Puzzle dates are UTC dates.

```sh
D=$(date -u +%F)        # today (UTC)
date -u -v-1d +%F       # yesterday (UTC), macOS
date -u -d yesterday +%F   # yesterday (UTC), Linux / WSL / Git Bash
date -u -v-32d +%F         # 32 days ago (UTC), macOS
date -u -d '32 days ago' +%F   # 32 days ago (UTC), Linux / WSL / Git Bash
```

## Example session

```sh
reg '{"email":"test1@example.com","password":"correct-horse-battery","displayName":"Tester"}'
# → 202; the verification email is printed in the npm run dev terminal

loginas test1                        # logs in and sets $T

me                                   # → 200 with the user
D=$(date -u +%F)
submit sudoku "$D" 500 1             # → 201
submit sudoku "$D" 600 1             # → 409 already_submitted
submit minesweeper "$D" 0 1          # → 201 (a loss)
myscores sudoku                      # → 200 with today's score, "nextBefore":null
myscores sudoku 'limit=1'            # → the newest score only (the played-today check)
dbq "SELECT puzzle_date, score, formula_version FROM scores;"

tokhash "$T"
dbq "SELECT LOWER(HEX(token_hash)) FROM sessions;"   # one row matches

signout                              # → 204
me                                   # → 401 invalid_token

dbq "DELETE FROM users WHERE email LIKE '%@example.com';"
```

## Score history test data

`submit` only accepts today's date, so older scores are inserted with SQL. Register and log in
`test1` first. This adds sudoku scores for days 1–75 before today, skipping days 10–12 (a gap), with
score `100 + days ago`, so each row's day is visible in its score:

```sh
dbq "INSERT INTO scores (user_id, game_id, puzzle_date, score, formula_version)
WITH RECURSIVE days (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM days WHERE n < 75)
SELECT u.id, g.id, UTC_DATE() - INTERVAL d.n DAY, 100 + d.n, 1
FROM days d
JOIN users u ON u.email = 'test1@example.com'
JOIN games g ON g.slug = 'sudoku'
WHERE d.n NOT BETWEEN 10 AND 12;"
```

With today's submitted score, that's 73 rows: `limit=30` pages of 30, 30, and 13.

For query plans, the table also needs other players' and games' rows. Otherwise test1's sudoku
rows are the whole table and MySQL correctly skips the index. Register `test2` first; this adds
365 days for test2 in every game and for test1 in every game except sudoku, then refreshes the
optimizer's statistics:

```sh
dbq "INSERT INTO scores (user_id, game_id, puzzle_date, score, formula_version)
WITH RECURSIVE days (n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM days WHERE n < 364)
SELECT u.id, g.id, UTC_DATE() - INTERVAL d.n DAY, 100 + d.n, 1
FROM days d CROSS JOIN users u CROSS JOIN games g
WHERE u.email IN ('test1@example.com', 'test2@example.com')
  AND NOT (u.email = 'test1@example.com' AND g.slug = 'sudoku');
ANALYZE TABLE scores;"
```

The history query's plan, with and without `before`:

```sh
dbq "SET @u = (SELECT id FROM users WHERE email = 'test1@example.com');
SET @g = (SELECT id FROM games WHERE slug = 'sudoku');
EXPLAIN SELECT puzzle_date, score, formula_version, created_at FROM scores
  WHERE user_id = @u AND game_id = @g ORDER BY puzzle_date DESC LIMIT 31;
EXPLAIN SELECT puzzle_date, score, formula_version, created_at FROM scores
  WHERE user_id = @u AND game_id = @g AND puzzle_date < UTC_DATE() - INTERVAL 32 DAY
  ORDER BY puzzle_date DESC LIMIT 31;"
```

Expected: `key` is `scores_user_id_game_id_puzzle_date_key`, `type` is `ref` then `range`, and
`Extra` includes `Backward index scan` without `Using filesort`.

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
