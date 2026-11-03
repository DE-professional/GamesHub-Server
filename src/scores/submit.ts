import type { RequestHandler } from "express";
import { z } from "zod";
import { authenticate } from "../auth/sessions.js";
import { prisma } from "../db.js";
import { describeError, HttpError, uniqueViolationIndex } from "../errors.js";
import { parseSlug } from "../games/slug.js";
import { fromUtcDateString, toUtcDateString } from "./dates.js";
import { scoreResponse } from "./response.js";

const SCORE_INDEX = "scores_user_id_game_id_puzzle_date_key"

//Cap max score
const MAX_SCORE = 1_000_000;

//So that puzzles completed shortly after the rollover aren't rejected
const GRACE_PERIOD_MS = 60 * 60 * 1000;

const submitSchema = z.object({
    puzzleDate: z.iso.date(),
    score: z.int().min(0).max(MAX_SCORE),
    formulaVersion: z.int().min(1).max(65_535), // Smallint limit
});

const FIELD_ERRORS = new Map([
    ["puzzleDate", { code: "invalid_puzzle_date", message: "puzzleDate must be a date in YYYY-MM-DD format" }],
    ["score", { code: "invalid_score", message: `score must be an integer from 0 to ${MAX_SCORE}` }],
    ["formulaVersion", { code: "invalid_formula_version", message: "formulaVersion must be an integer from 1 to 65535" }],
]);

// UTC dates that accept submissions right now: today, plus yesterday during the grace period.
function openPuzzleDates(now:Date): Set<string>{
    return new Set([toUtcDateString(now), toUtcDateString(new Date(now.getTime() - GRACE_PERIOD_MS))]);
}

export const submitScore: RequestHandler = async (req, res) => {
    const { user } = await authenticate(req, res);
    const slug = parseSlug(req.params.slug);

    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
        const field = parsed.error.issues[0]?.path[0];
        const fieldError = typeof field === "string" ? FIELD_ERRORS.get(field) : undefined;
        if (fieldError) {
            throw new HttpError(400, fieldError.code, fieldError.message);
        }
        throw new HttpError(400, "invalid_body", "Body must be a JSON object with puzzleDate, score, and formulaVersion");
    }
    const { puzzleDate, score, formulaVersion } = parsed.data;

    if (!openPuzzleDates(new Date()).has(puzzleDate)) {
        throw new HttpError(400, "puzzle_date_closed", "Scores can only be submitted for today's puzzle (UTC)");
    }

    const game = await prisma.game
        .findUnique({ where: { slug }, select: { id: true, slug: true } })
        .catch((err: unknown) => {
            throw new Error(`Game lookup failed: ${describeError(err)}`);
        });
    if (game === null) {
        throw new HttpError(404, "game_not_found", "Game not found");
    }

    const created = await prisma.score
        .create({
            data: { userId: user.id, gameId: game.id, puzzleDate: fromUtcDateString(puzzleDate), score, formulaVersion },
            select: { puzzleDate: true, score: true, formulaVersion: true, createdAt: true },
        })
        .catch((err: unknown) => {
            if (uniqueViolationIndex(err) === SCORE_INDEX) {
                throw new HttpError(409, "already_submitted", "A score was already submitted for this game today");
            }
            throw new Error(`Score insert failed: ${describeError(err)}`);
        });

    res.status(201).json({ score: scoreResponse(game.slug, created) });
};

