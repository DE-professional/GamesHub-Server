import { toUtcDateString } from "./dates.js";

export function scoreResponse(
    gameSlug: string,
    row:{puzzleDate: Date; score: number; formulaVersion: number; createdAt: Date},
){
    return{
        game:gameSlug,
        puzzleDate: toUtcDateString(row.puzzleDate),
        score: row.score,
        formulaVersion: row.formulaVersion,
        submittedAt: row.createdAt.toISOString(),
    };
}