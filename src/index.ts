import express from "express"
import {prisma} from "./db.js";
import {z} from "zod";
import {config} from "./config.js";
import {HttpError, errorHandler, notFound} from "./errors.js";
import { authRouter } from "./auth/routes.js";
import { parseSlug } from "./games/slug.js";
import { requireJson } from "./middleware.js";
import { submitScore } from "./scores/submit.js";

const slugSchema = z.string().regex(/^[a-z0-9-]{1,64}$/);
const app = express();

// Largest planned body is registration (~3 KB worst case); see PROJECT_CONTEXT.
app.use(express.json({limit:"16kb"}));

app.use("/auth", authRouter);

app.get("/games/:slug", async (req, res) => {
    const slug = parseSlug(req.params.slug)
    const game = await prisma.game.findUnique({where:{slug:slug}});
    if(!game){
        throw new HttpError(404,"game_not_found",`No game with slug "${slug}" found`);
    }
    res.json({ slug: game.slug, name: game.name });

});

app.post("/games/:slug/scores", requireJson, submitScore);

app.use(notFound);

app.use(errorHandler);

app.listen(config.PORT,(err)=>{
    if(err) throw err;
    console.log(`Listening on http://localhost:${config.PORT}`);
    console.log(`Email transport: ${config.EMAIL_TRANSPORT}`);
});
