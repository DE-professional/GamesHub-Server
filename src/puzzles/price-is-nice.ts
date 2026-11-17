import { randomInt } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { describeError, uniqueViolationIndex } from "../errors.js";
import { fromUtcDateString, toUtcDateString } from "../scores/dates.js";
import { fetchAppDetails, fetchAppIds, SteamUnavailableError, type SteamAppDetails } from "./steam.js";

// Price Is Nice: the server picks one Steam game per puzzle date, stores it, and serves the
// stored pick to everyone. See docs/price-is-nice-puzzle.md.

export const PRICE_IS_NICE_SLUG = "price-is-nice";

const PUZZLE_INDEX = "price_is_nice_puzzles_puzzle_date_key";

const MAX_CANDIDATES = 60;        // random games tried per pick; Steam allows ~200 store requests / 5 min
const MAX_SCREENSHOTS = 12;       // stored per game; the client downloads fewer
const MAX_NAME_LENGTH = 255;      // VarChar(255), counted in code points
const MAX_PRICE_FORMATTED_LENGTH = 32;
const APP_LIST_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 60_000; // after a failed pick, answer 503 at once instead of asking Steam again

// Steam content descriptors: 1 some nudity or sexual content, 3 adult only sexual content,
// 4 frequent nudity or sexual content, 5 general mature content.
const BLOCKED_DESCRIPTOR_IDS = new Set([1, 3, 4, 5]);
const BLOCKED_GENRES = new Set(["nudity", "sexual content", "erotic", "anime", "romance"]);
const MIN_BLOCKED_AGE = 17;

// No puzzle can be served for this date right now (no API key, Steam unavailable, no suitable
// game, or a recent failure). The route answers 503 puzzle_unavailable.
export class PuzzleUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PuzzleUnavailableError";
    }
}

const PUZZLE_SELECT = {
    puzzleDate: true,
    steamAppId: true,
    name: true,
    shortDescription: true,
    priceCents: true,
    priceFormatted: true,
    screenshots: true,
} as const;

type PuzzleRow = {
    puzzleDate: Date;
    steamAppId: number;
    name: string;
    shortDescription: string;
    priceCents: number;
    priceFormatted: string;
    screenshots: unknown;
};

const inFlight = new Map<string, Promise<PuzzleRow>>(); // one pick per date at a time
const failedAt = new Map<string, number>();
const stored = new Set<string>();                        // dates known to have a row
let appListCache: { ids: number[]; fetchedAt: number } | undefined;

// The puzzle for an open "YYYY-MM-DD" date, picking and storing it on first request.
// Concurrent first requests share one pick.
export async function getPriceIsNicePuzzle(puzzleDate: string): Promise<PuzzleRow> {
    const existing = await findPuzzle(puzzleDate);
    if (existing !== null) return existing;

    const apiKey = config.STEAM_API_KEY;
    if (apiKey === undefined) throw new PuzzleUnavailableError("STEAM_API_KEY is not set");

    const failed = failedAt.get(puzzleDate);
    if (failed !== undefined && Date.now() - failed < FAILURE_COOLDOWN_MS) {
        throw new PuzzleUnavailableError("the last attempt failed less than a minute ago");
    }

    let pending = inFlight.get(puzzleDate);
    if (pending === undefined) {
        pending = createPuzzle(puzzleDate, apiKey)
            .then(
                (row) => {
                    failedAt.delete(puzzleDate);
                    return row;
                },
                (err: unknown) => {
                    failedAt.set(puzzleDate, Date.now());
                    if (err instanceof SteamUnavailableError || err instanceof PuzzleUnavailableError) {
                        // Logged once here, not on every request that gets the 503.
                        console.warn(`Price Is Nice puzzle for ${puzzleDate} could not be picked: ${err.message}`);
                        throw new PuzzleUnavailableError(err.message);
                    }
                    throw err;
                },
            )
            .finally(() => inFlight.delete(puzzleDate));
        inFlight.set(puzzleDate, pending);
    }
    return pending;
}

// Picks a date's puzzle in the background (e.g. tomorrow's), so its first player doesn't wait
// for Steam. Does nothing once the date has a row.
export function prefetchPriceIsNicePuzzle(puzzleDate: string): void {
    if (stored.has(puzzleDate) || inFlight.has(puzzleDate)) return;
    getPriceIsNicePuzzle(puzzleDate).catch((err: unknown) => {
        // PuzzleUnavailableError was already logged (or is just a missing key / cooldown).
        if (!(err instanceof PuzzleUnavailableError)) {
            console.error(`Price Is Nice prefetch for ${puzzleDate} failed: ${describeError(err)}`);
        }
    });
}

// Response object for a stored puzzle. Built field by field, like the other response builders.
export function puzzleResponse(row: PuzzleRow) {
    const screenshots = z.array(z.string()).safeParse(row.screenshots);
    return {
        puzzleDate: toUtcDateString(row.puzzleDate),
        steamAppId: row.steamAppId,
        name: row.name,
        shortDescription: row.shortDescription,
        price: { cents: row.priceCents, formatted: row.priceFormatted },
        screenshots: screenshots.success ? screenshots.data : [],
    };
}

async function findPuzzle(puzzleDate: string): Promise<PuzzleRow | null> {
    const row = await prisma.priceIsNicePuzzle
        .findUnique({ where: { puzzleDate: fromUtcDateString(puzzleDate) }, select: PUZZLE_SELECT })
        .catch((err: unknown) => {
            throw new Error(`Puzzle lookup failed: ${describeError(err)}`);
        });
    if (row !== null) stored.add(puzzleDate);
    return row;
}

// Insert first, as for scores: if another server process stored this date in the meantime,
// the unique index rejects ours and we serve theirs.
async function createPuzzle(puzzleDate: string, apiKey: string): Promise<PuzzleRow> {
    const picked = await pickGame(apiKey);
    const row = await prisma.priceIsNicePuzzle
        .create({ data: { puzzleDate: fromUtcDateString(puzzleDate), ...picked }, select: PUZZLE_SELECT })
        .catch(async (err: unknown) => {
            if (uniqueViolationIndex(err) === PUZZLE_INDEX) {
                const existing = await findPuzzle(puzzleDate);
                if (existing !== null) return existing;
            }
            throw new Error(`Puzzle insert failed: ${describeError(err)}`);
        });
    stored.add(puzzleDate);
    return row;
}

async function pickGame(apiKey: string) {
    const ids = await appIds(apiKey);
    if (ids.length === 0) throw new PuzzleUnavailableError("Steam app list is empty");

    for (let i = 0; i < MAX_CANDIDATES; i++) {
        const appId = ids[randomInt(ids.length)];
        const details = await fetchAppDetails(appId);
        if (details === null || isNsfw(details)) continue;

        // US prices only (the request asks for cc=us). Free and unpriced games have no price_overview.
        const price = details.price_overview;
        if (price === undefined || price.currency !== "USD" || price.final <= 0) continue;
        if (!price.final_formatted.startsWith("$") || price.final_formatted.length > MAX_PRICE_FORMATTED_LENGTH) continue;

        // The player guesses from the screenshots, so a game without any is no puzzle.
        const screenshots = (details.screenshots ?? []).slice(0, MAX_SCREENSHOTS).map((s) => s.path_full);
        if (screenshots.length === 0) continue;

        const name = details.name.trim();
        if (name === "" || [...name].length > MAX_NAME_LENGTH) continue;

        return {
            steamAppId: appId,
            name,
            shortDescription: decodeHtmlEntities(details.short_description).trim(),
            priceCents: price.final,
            priceFormatted: price.final_formatted,
            screenshots,
        };
    }
    throw new PuzzleUnavailableError(`no suitable game in ${MAX_CANDIDATES} candidates`);
}

async function appIds(apiKey: string): Promise<number[]> {
    if (appListCache !== undefined && Date.now() - appListCache.fetchedAt < APP_LIST_TTL_MS) {
        return appListCache.ids;
    }
    const ids = await fetchAppIds(apiKey);
    appListCache = { ids, fetchedAt: Date.now() };
    return ids;
}

function isNsfw(details: SteamAppDetails): boolean {
    const descriptorIds = details.content_descriptors?.ids ?? [];
    if (descriptorIds.some((id) => BLOCKED_DESCRIPTOR_IDS.has(id))) return true;

    const age = typeof details.required_age === "number"
        ? details.required_age
        : Number.parseInt(details.required_age ?? "0", 10); // "17+" parses as 17
    if (Number.isFinite(age) && age >= MIN_BLOCKED_AGE) return true;

    return (details.genres ?? []).some((genre) => BLOCKED_GENRES.has(genre.description.toLowerCase()));
}

// Steam's short descriptions contain HTML entities (&quot;, &amp;, ...). One pass, so "&amp;quot;"
// becomes "&quot;" rather than a quote.
const NAMED_ENTITIES: Record<string, string> = { quot: '"', amp: "&", apos: "'", lt: "<", gt: ">", nbsp: " " };

function decodeHtmlEntities(text: string): string {
    return text.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]+);/gi, (match, entity: string) => {
        if (entity[0] === "#") {
            const hex = entity[1] === "x" || entity[1] === "X";
            const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
        }
        return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    });
}
