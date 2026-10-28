import express from "express"
import { error } from "node:console";
import {prisma} from "./db";
import {z} from "zod";
import {HttpError, errorHandler, notFound} from "./errors";

const slugSchema = z.string().regex(/^[a-z0-9]{1,64}$/);
const app = express();

app.get("/hello", (req,res)=>{
    res.json({message:"Hello!"});
});

app.get("/boom", () => {
  throw new Error("something broke");
});

app.get("/games/:slug", async (req, res) => {
    const slug = slugSchema.safeParse(req.params.slug);
    if(!slug.success){
        throw new HttpError(400, "invalid_slug", "Slug must be 1-64 lowercase letters, digits, or dashes")
    }
    const game = await prisma.game.findUnique({where:{slug:slug.data}});
    if(!game){
        throw new HttpError(404,"game_not_found",`No game with slug "${slug.data}" found`);
    }
    res.json({ slug: game.slug, name: game.name });

});



app.use(notFound);
app.use(errorHandler);

app.listen(3900,()=>{
    console.log("Listening on http://localhost:3900");
});
