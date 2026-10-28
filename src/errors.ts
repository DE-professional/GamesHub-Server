import type { ErrorRequestHandler, RequestHandler } from "express";

export class HttpError extends Error{
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
    ){
        super(message);
        this.name = "HttpError";
    }
}

export const notFound: RequestHandler = (req, _res, next) =>{
    next(new HttpError(404, "route_not_found", `No route for ${req.method} ${req.path}`));
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) =>{
    if(res.headersSent){
        return next(err);
    }
    if (err instanceof HttpError){
        res.status(err.status).json({error:{code: err.code, message: err.message}});
        return;
    }
    console.error(err);
    res.status(500).json({error:{code:"internal_error",message: "Something went REALLY wrong"}});
};