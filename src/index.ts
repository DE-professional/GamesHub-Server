import express from "express"
import {config} from "./config.js";
import { cors, describeCors } from "./cors.js";
import {errorHandler, notFound} from "./errors.js";
import { authRouter } from "./auth/routes.js";
import { requireGame } from "./games/lookup.js";
import { parseSlug } from "./games/slug.js";
import { requireJson } from "./middleware.js";
import { getMyScores } from "./scores/history.js";
import { submitScore } from "./scores/submit.js";
import { getDailyPuzzle } from "./puzzles/routes.js";
import { getAllTimeLeaderboard, getDailyLeaderboard } from "./leaderboards/routes.js";

const app = express();

// First: preflights are answered before body parsing, and every response (errors included) gets
// its CORS headers. See src/cors.ts.
app.use(cors);

// Largest planned body is registration (~3 KB worst case); see PROJECT_CONTEXT.
app.use(express.json({limit:"16kb"}));

app.use("/auth", authRouter);

app.get("/games/:slug", async (req, res) => {
    const game = await requireGame(parseSlug(req.params.slug));
    res.json({ slug: game.slug, name: game.name });
});

app.post("/games/:slug/scores", requireJson, submitScore);
app.get("/games/:slug/scores/me", getMyScores);
app.get("/games/:slug/puzzle", getDailyPuzzle);
app.get("/games/:slug/leaderboard/daily", getDailyLeaderboard);
app.get("/games/:slug/leaderboard/all-time", getAllTimeLeaderboard);

app.use(notFound);

app.use(errorHandler);

app.listen(config.PORT,(err)=>{
    if(err) throw err;
    console.log(`Listening on http://localhost:${config.PORT}`);
    console.log(`Email transport: ${config.EMAIL_TRANSPORT}`);
    console.log(`CORS: ${describeCors()}`);
    console.log(`Price Is Nice puzzles: ${config.STEAM_API_KEY ? "enabled" : "disabled (STEAM_API_KEY not set)"}`);
});
