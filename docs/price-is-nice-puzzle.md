# Price Is Nice: Server-Picked Daily Game

Nov 17, 2026 · Status: built and verified against a local server (branch `price-is-nice-puzzles`)

Decisions 35–43 in `PROJECT_CONTEXT.md` record the reasoning in brief. This document is the full
design, for whoever changes it next.

## Why

Price Is Nice shows screenshots of a Steam game and asks whether it costs more or less than a
shown price. Until now the Unity client picked the day's game itself: a seeded random walk over
Steam's app list, calling Steam's APIs directly. That had four problems:

1. **It can't work in WebGL**, the primary target. A browser only lets the game call another site's
   API if that API sends CORS headers. `store.steampowered.com/api/appdetails` sends none (checked
   November 17, 2026), so every request from a WebGL build fails.
2. **The Steam Web API key shipped in the client** (it's in the Unity repo's history), and anyone
   could extract it from a build.
3. **Players got different games on the same day:**
   - Each device downloaded and cached its own copy of the app list, which changes over time, so
     the same random index pointed at different games.
   - A failed request moved on to the next random candidate, so a network hiccup shifted that
     player's whole sequence.
   - Steam returns prices in the requester's currency. A European player got € prices, which the
     client rejected (it wanted `$`), and moved on to a different game.
4. **Slow:** the first launch on each device downloaded several MB of app list, then queried Steam
   until it found a suitable game.

## Design

The server picks the day's game **once**, stores it, and serves the stored pick to everyone.

```text
Unity main menu ──GET /games/price-is-nice/puzzle?puzzleDate=D──▶ GamesHub server
                                                                  │
                                    row for D in price_is_nice_puzzles? ──yes──▶ 200 (stored pick)
                                                                  │ no
                                                                  ▼
                                   pick a game from Steam (once, shared by concurrent requests)
                                   store it ──▶ 200
                                   and, if D is today, start picking D+1 in the background
Unity ──screenshot URLs──▶ Steam CDN (CORS allowed)
```

### Storage

Table `price_is_nice_puzzles`, one row per puzzle date, written once and never changed:

| Column | Type | Notes |
|---|---|---|
| `puzzle_date` | DATE, unique | the UTC puzzle date |
| `steam_app_id` | INT UNSIGNED | |
| `name` | VARCHAR(255) | trimmed |
| `short_description` | TEXT | HTML entities decoded |
| `price_cents` | INT UNSIGNED | US price when picked, after any discount; > 0 |
| `price_formatted` | VARCHAR(32) | Steam's string, e.g. `$9.99` |
| `screenshots` | JSON | 1–12 https URLs on Steam's CDN |
| `created_at` | DATETIME(3) | when it was picked |

Because the pick is stored, it no longer needs to be reproducible: the server uses
`crypto.randomInt`, with no seed.

### When the game is picked

- **On first request.** The first request for a date with no row triggers the pick. Concurrent
  requests in the same process share one in-flight pick per date. Across processes, the unique index
  decides: insert first, and on a unique violation (P2002 on
  `price_is_nice_puzzles_puzzle_date_key`) read and serve the row that won.
- **Look-ahead.** Serving *today's* puzzle starts *tomorrow's* pick in the background (once per
  date per process), so the first player after midnight UTC doesn't wait for Steam.
- **Rejected alternative:** a scheduled job at midnight UTC. It needs a scheduler in production, and
  the look-ahead achieves the same result without one.

Timings measured locally:
- The first pick after a server start takes ~12 s, most of it downloading Steam's app list.
- Later picks take 0.5–3 s; the app list is cached in memory for 24 h.
- A stored pick is served in ~10 ms.

### Selection rules

Up to 60 random candidates from the app list, keeping the first that passes all of these:

- **Listing exists:** `appdetails` returns `success: true` with readable data.
- **Not NSFW:**
  - content descriptors 1 (some nudity or sexual content), 3 (adult only sexual content),
    4 (frequent nudity or sexual content) or 5 (general mature content)
  - `required_age` ≥ 17
  - genre Nudity, Sexual Content, Erotic, Anime or Romance
- **Priced in USD:** requests use `cc=us&l=english`; needs `price_overview.currency == "USD"`,
  `final > 0` (cents) and a `final_formatted` starting with `$`. Free and unreleased games have no
  `price_overview` and are skipped.
- **Has screenshots:** at least one (the player guesses from them). Up to 12 are stored.
- **Name length:** non-empty, at most 255 characters.

Two changes from the Unity version:
- Descriptor 4 was missing.
- `required_age` is a number in Steam's responses, and the Unity code compared it with the strings
  `"18"` and `"17+"`, so the age filter never matched.

### Steam client

`src/puzzles/steam.ts`:

- **`fetchAppIds(apiKey)`:** `IStoreService/GetAppList/v1`, games only, 50,000 per page, following
  `have_more_results` / `last_appid` (at most 10 pages).
- **`fetchAppDetails(appId)`:** `store.steampowered.com/api/appdetails?appids=ID&cc=us&l=english`.
  The response is keyed by the app id (`{"620": {"success": true, "data": {...}}}`).
- **Validation:** every response is checked with zod. Unknown fields are dropped; an unexpected
  shape counts as "no usable listing".
- **Retries:** a 20 s timeout per request. Network errors, timeouts, 429 and 5xx are retried 3 times
  with 1 s and 2 s back-off; other 4xx are not retried.
- **No secrets in logs:** error messages never contain URLs, because the app list URL carries the key.

### Failure handling

- **Missing key:** if `STEAM_API_KEY` is unset or empty, the server still starts, logs
  `Price Is Nice puzzles: disabled`, and the endpoint answers `503 puzzle_unavailable` for dates
  with no row. It's optional so teammates can run the server without a Steam key.
- **Failed pick:** if Steam is unreachable or no candidate passes, the endpoint answers `503`.
  The failure is logged once, not per request. For the next 60 s, that date answers `503` at once
  instead of asking Steam again.
- **Answer never changes:** the price is never refreshed after the pick, so it can't change during
  the day, even if a sale starts or ends.

## API

`GET /games/:slug/puzzle?puzzleDate=YYYY-MM-DD` (no login: guests play too).

```json
{
  "puzzle": {
    "puzzleDate": "2026-11-17",
    "steamAppId": 620,
    "name": "Portal 2",
    "shortDescription": "The \"Perpetual Testing Initiative\" has been expanded...",
    "price": { "cents": 999, "formatted": "$9.99" },
    "screenshots": ["https://shared.akamai.steamstatic.com/.../ss_....1920x1080.jpg?t=..."]
  }
}
```

The checks run in this order; the first one that fails decides the response:

| Order | Status | Code | When |
|---|---|---|---|
| 1 | 400 | `invalid_slug` | Slug isn't 1–64 lowercase letters, digits, or hyphens |
| 2 | 400 | `invalid_puzzle_date` | `puzzleDate` missing, repeated, or not a real `YYYY-MM-DD` date |
| 3 | 400 | `puzzle_date_closed` | Not today, and not yesterday within the first hour after midnight UTC |
| 4 | 404 | `game_not_found` | No game has this slug |
| 5 | 404 | `puzzle_not_served` | Any game but `price-is-nice` (they build their puzzles on the client) |
| 6 | 503 | `puzzle_unavailable` | No key, Steam unreachable, no suitable game, or within 60 s of a failed pick |

- **Same date window as scores.** It's the window score submission uses: `openPuzzleDates` was
  moved from `scores/submit.ts` into `scores/dates.ts`, and both routes use it. So tomorrow's game
  can't be peeked at.
- **Generic route.** It's generic so another game could get server-picked puzzles later.
- **No past puzzles.** Past dates aren't served; nothing needs them yet.
- **The response contains the answer.** That's consistent with scores being client-reported
  (decision 17): anyone determined can read the price, just as anyone can submit any score.
- **Caching:** `Cache-Control: public, max-age=300`. The puzzle is the same for everyone and fixed
  once picked.
- **Screenshots aren't proxied.** Steam's CDN sends `Access-Control-Allow-Origin: *` (checked
  November 17, 2026), so a WebGL build loads them directly and the server only hands out URLs.

## Client (Unity repo)

- **`Util/PuzzleService.cs`** (`Services.Puzzles`) calls the endpoint through the shared
  `ApiClient`, without the login token. It maps the response to a `PuzzleOutcome`:
  - `Success`
  - `Unavailable` (`503`, or the server unreachable)
  - `DateClosed`
  - `Error`, logged
- **`PriceIsNice/PriceIsNiceLoader.cs`:**
  - **Requests:** fetches the puzzle, retrying `Unavailable` up to 3 times, 3 s apart. A first pick
    can take ~12 s, close to the client's 15 s timeout.
  - **Screenshots:** downloads up to 8 of them in parallel, each into a GPU-only texture.
  - **Cache:** keeps the result across scene loads.
  - **Clean-up:** deletes the obsolete `applist.json` cache from players' devices once.
- **Preload:** the main menu calls `PriceIsNiceLoader.Preload(today)` unless today's puzzle was
  already played. The game calls `WaitAsync(date)` and shows "Couldn't load today's game…" if it
  fails; returning to the menu retries.
- **Removed:** all direct Steam calls, the API key, the app list cache and the Steam JSON types.

## Operations

- **Rotate the key.** The key in the Unity repo's history is public. Revoke it on
  <https://steamcommunity.com/dev/apikey>, create a new one, and set it only in the server's
  environment.
- **CORS is still required for WebGL.** Steam no longer has to allow cross-origin requests, but
  the GamesHub API does. That's the step 6 release blocker; until it's done, a WebGL build can't
  reach this endpoint either.
- **Re-picking a day** (development only; players who already saw the old game would disagree):
  `dbq "DELETE FROM price_is_nice_puzzles WHERE puzzle_date = 'YYYY-MM-DD';"`

## Verification (November 17, 2026)

Run against a local server with the `puzzle` helper from `DEV_COMMANDS.md`:

- Missing, invalid (`2026-13-01`) or repeated `puzzleDate` → `400 invalid_puzzle_date`.
- Two days ago and tomorrow → `400 puzzle_date_closed`.
- `Bad_Slug` → `400 invalid_slug`; `nope` → `404 game_not_found`; `sudoku` → `404 puzzle_not_served`.
- **Today:**
  - The first request after a server start → `200` in ~12 s.
  - Repeats → `200` in ~10 ms, with the cache header.
  - Tomorrow's row appeared within a second (the look-ahead).
- **Concurrency:** after deleting today's row, five simultaneous requests all returned `200` with
  the same game (~3 s each), and exactly one row was stored.
- **Missing key:** a second instance with an empty `STEAM_API_KEY` logged "disabled" at startup and
  answered `503 puzzle_unavailable`.
- **Not exercised yet:** Steam being unreachable, and the 60 s cooldown.

## Open items

- **Steam's terms:** whether Steam allows store data (names, prices, screenshots) in a hosted public
  game.
- **Rate limits:** whether Steam's store rate limits are a concern in production. A pick is at most
  60 requests, once a day, so it should be far below them.
- **Past puzzles:** serving past dates, if a "yesterday's game" feature is wanted.
