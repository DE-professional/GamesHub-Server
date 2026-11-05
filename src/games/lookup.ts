import { prisma } from "../db.js";
import { describeError, HttpError } from "../errors.js";

// Finds a game by an already validated slug (see parseSlug), or throws 404 game_not_found.
export async function requireGame(slug: string): Promise<{ id: number; slug: string; name: string }> {
    const game = await prisma.game
        .findUnique({ where: { slug }, select: { id: true, slug: true, name: true } })
        .catch((err: unknown) => {
            throw new Error(`Game lookup failed: ${describeError(err)}`);
        });
    if (game === null) {
        throw new HttpError(404, "game_not_found", `No game with slug "${slug}"`);
    }
    return game;
}
