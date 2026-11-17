import type { RequestHandler } from "express";
import { config } from "./config.js";

// Cross-origin access for the WebGL build, which runs on another site (itch.io) and so needs the
// browser's permission to call this API. The Unity Editor and curl ignore all of this.
//
// - An allowed Origin is echoed back in Access-Control-Allow-Origin on every response, errors
//   included, so the game can read error codes.
// - Preflights (OPTIONS with Access-Control-Request-Method) are answered here with 204, before any
//   route or body parsing: they never reach the routes.
// - No Access-Control-Allow-Credentials: the API uses bearer tokens, not cookies.
// - Vary: Origin on every response, so a shared cache (the puzzle endpoint is cacheable) never hands
//   one site's copy, with its Allow-Origin header, to another.

const ALLOWED_METHODS = "GET, POST, PUT, DELETE";
const ALLOWED_HEADERS = "Authorization, Content-Type";
const PREFLIGHT_MAX_AGE_SECONDS = 600; // browsers cache the preflight result this long (Chrome caps at 7200)
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const allowedOrigins = new Set(config.CORS_ORIGINS);

// Each rejected origin is logged once, so the real origin of a new deployment (e.g. itch.io's game
// frame) shows up in the log. Capped so a flood of made-up origins can't fill it.
const loggedRejections = new Set<string>();
const MAX_LOGGED_REJECTIONS = 100;

function isAllowedOrigin(origin: string): boolean {
    if (allowedOrigins.has(origin)) return true;
    if (!config.CORS_ALLOW_LOCALHOST) return false;
    try {
        const url = new URL(origin);
        return url.origin === origin && url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
    } catch {
        return false; // e.g. the literal "null" origin of sandboxed frames and file:// pages
    }
}

function logRejection(origin: string): void {
    if (loggedRejections.has(origin) || loggedRejections.size >= MAX_LOGGED_REJECTIONS) return;
    loggedRejections.add(origin);
    // JSON.stringify: the header is client-controlled; this keeps it on one line, quoted.
    console.warn(`CORS: rejected origin ${JSON.stringify(origin)}; add it to CORS_ORIGINS to allow it`);
}

export const cors: RequestHandler = (req, res, next) => {
    res.vary("Origin");

    const origin = req.get("Origin");
    const allowed = origin !== undefined && isAllowedOrigin(origin);
    if (allowed) {
        res.set("Access-Control-Allow-Origin", origin);
    } else if (origin !== undefined) {
        logRejection(origin);
    }

    const isPreflight = req.method === "OPTIONS" && origin !== undefined && req.get("Access-Control-Request-Method") !== undefined;
    if (!isPreflight) {
        next();
        return;
    }

    // Answered for every origin; only an allowed one gets the headers that let the request through.
    if (allowed) {
        res.set({
            "Access-Control-Allow-Methods": ALLOWED_METHODS,
            "Access-Control-Allow-Headers": ALLOWED_HEADERS,
            "Access-Control-Max-Age": String(PREFLIGHT_MAX_AGE_SECONDS),
        });
    }
    res.status(204).end();
};

// One line for the startup log.
export function describeCors(): string {
    const parts = config.CORS_ORIGINS.length > 0 ? [config.CORS_ORIGINS.join(", ")] : [];
    if (config.CORS_ALLOW_LOCALHOST) parts.push("any http://localhost port");
    return parts.length > 0 ? parts.join(" + ") : "off (no origins allowed)";
}
