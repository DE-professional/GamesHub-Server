import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "./generated/prisma/client.js";
import { z } from "zod";
type ErrorMapping = {status: number; code: string; message: string};

const bodyParserErrors = new Map<string, ErrorMapping>([
    ["entity.parse.failed", {status:400, code:"invalid_json", message:"Request body is not valid JSON"}],
    ["entity.too.large", {status:413,code:"payload_too_large",message:"Request body is too large"}],
    ["request.size.invalid", { status: 400, code: "invalid_body", message: "Request body length does not match Content-Length" }],
    ["request.aborted", { status: 400, code: "request_aborted", message: "Request was aborted by the client" }],
    ["encoding.unsupported", { status: 415, code: "unsupported_encoding", message: "Unsupported Content-Encoding" }],
    ["charset.unsupported", { status: 415, code: "unsupported_charset", message: "Unsupported charset; use UTF-8" }],
]);

function fromBodyParserError(err: unknown): HttpError | undefined{
    if(typeof err !== "object" || err === null || !("type" in err) || typeof err.type !== "string"){
        return undefined;
    }
    const mapping = bodyParserErrors.get(err.type);
    return mapping && new HttpError(mapping.status, mapping.code, mapping.message);
}


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
    const httpError = err instanceof HttpError ? err : fromBodyParserError(err);
    if (httpError){
        res.status(httpError.status).json({error:{code: httpError.code, message: httpError.message}});
        return;
    }
    console.error(err);
    res.status(500).json({error:{code:"internal_error",message: "Internal server error"}});
};

// For logging special errors that may expose sensitive details if not contained properly 
// Errors from these queries can contain the email address (P2002's meta quotes the duplicate
// value), so only the error's type and code are ever logged.
export function describeError(err: unknown): string {
    if (err instanceof Prisma.PrismaClientKnownRequestError) return `Prisma ${err.code}`;
    if (err instanceof Error) return err.name;
    return "non-Error value";
}// Shape measured on Prisma 7.10.1 with the MariaDB adapter; see PROJECT_CONTEXT.
const uniqueViolationMeta = z.object({
    driverAdapterError: z.object({
        cause: z.object({ constraint: z.object({ index: z.string() }) }),
    }),
});
// Returns the violated index for a P2002, "unrecognized" for a P2002 of unknown shape,
// or undefined for any other error.
export function uniqueViolationIndex(err: unknown): string | undefined {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") {
        return undefined;
    }
    const meta = uniqueViolationMeta.safeParse(err.meta);
    return meta.success ? meta.data.driverAdapterError.cause.constraint.index : "unrecognized";
}

