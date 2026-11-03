import type { RequestHandler } from "express";
import { HttpError } from "./errors.js";

export const requireJson: RequestHandler = (req, _res, next) =>{
    if(!req.is("application/json")){
        throw new HttpError(415, "unsupported_media_type", "Content must be application/json");
    }
    next();
};
