import type { RequestHandler } from "express";
import { z } from "zod";
import { authenticate } from "../auth/sessions.js";
import { prisma } from "../db.js";
import { describeError, HttpError } from "../errors.js";
import { requireGame } from "../games/lookup.js";
import { parseSlug } from "../games/slug.js";
import { fromUtcDateString, toUtcDateString } from "./dates.js";
import { scoreResponse } from "./response.js";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

// Earliest date a MySQL DATE column can hold. Earlier `before` values are rejected instead of
// being passed to the driver, whose handling of out-of-range dates is untested.
const MIN_DATE = "1000-01-01";

// Query values are always strings. The regex allows plain digits only: z.coerce.number() would
// also accept "", " 5", "1e1", and "0x10". A repeated parameter (?limit=1&limit=2) arrives as an
// array and fails the string check.
// YYYY-MM-DD strings have a fixed width, so comparing them as strings compares the dates.
const historyQuerySchema = z.object({
    limit: z.string().regex(/^\d{1,3}$/).transform(Number).pipe(z.int().min(1).max(MAX_LIMIT)).optional(),
    before: z.iso.date().refine((value) => value >= MIN_DATE).optional(),
});

const QUERY_ERRORS = new Map([
    ["limit", { code: "invalid_limit", message: `limit must be an integer from 1 to ${MAX_LIMIT}` }],
    ["before", { code: "invalid_before", message: `before must be a date from ${MIN_DATE} onward, in YYYY-MM-DD format` }],
]);

function parseHistoryQuery(query: unknown): { limit: number; before: string | undefined } {
    const parsed = historyQuerySchema.safeParse(query);
    if (!parsed.success) {
        const field = parsed.error.issues[0]?.path[0];
        const fieldError = typeof field === "string" ? QUERY_ERRORS.get(field) : undefined;
        if (fieldError) {
            throw new HttpError(400, fieldError.code, fieldError.message);
        }
        // req.query is always an object, so every issue should belong to limit or before.
        throw new Error("Unexpected score history query validation issue");
    }
    return { limit: parsed.data.limit ?? DEFAULT_LIMIT, before: parsed.data.before };
}

// The logged-in player's scores for one game, newest first, paginated by puzzle date.
// The client passes nextBefore as `before` to get the next (older) page.
export const getMyScores: RequestHandler = async (req, res) => {
    const { user } = await authenticate(req, res);
    const slug = parseSlug(req.params.slug);
    const { limit, before } = parseHistoryQuery(req.query);
    const game = await requireGame(slug);

    // One extra row tells us whether an older page exists, without a COUNT query.
    // Served by the unique index (user_id, game_id, puzzle_date) in both filter and order.
    const rows = await prisma.score
        .findMany({
            where: {
                userId: user.id,
                gameId: game.id,
                // undefined means "no condition" to Prisma: without `before`, start at the newest.
                puzzleDate: before === undefined ? undefined : { lt: fromUtcDateString(before) },
            },
            orderBy: { puzzleDate: "desc" },
            take: limit + 1,
            select: { puzzleDate: true, score: true, formulaVersion: true, createdAt: true },
        })
        .catch((err: unknown) => {
            throw new Error(`Score history query failed: ${describeError(err)}`);
        });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const oldest = page.at(-1);
    const nextBefore = hasMore && oldest !== undefined ? toUtcDateString(oldest.puzzleDate) : null;

    // Per-player data that changes on every submission: never reuse a stored copy.
    res.set("Cache-Control", "no-store");
    res.json({ scores: page.map((row) => scoreResponse(game.slug, row)), nextBefore });
};
