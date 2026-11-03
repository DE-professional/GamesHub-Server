import {z} from "zod";
import { HttpError } from "../errors.js";

const slugSchema = z.string().regex(/^[a-z0-9-]{1,64}$/);

export function parseSlug(value:unknown):string{
    const parsed = slugSchema.safeParse(value);
    if(!parsed.success){
        throw new HttpError(400,"invalid_slug","Game slug must be 1-64 lowercase letters, digits, or hyphens");
    }
    return parsed.data
}