import type { Request, Response } from "express";
import { prisma } from "../db.js";
import { describeError, HttpError } from "../errors.js";
import { hashToken, issueToken, type IssuedToken } from "./token.js";

// Fixed lifetime: using a session does not extend it.
export const SESSION_TTL_DAYS = 30;

export function createSessionToken(): IssuedToken {
    return issueToken(SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

// "Bearer " (scheme is case-insensitive) + 32 random bytes in unpadded base64url = 43 characters.
const BEARER_PATTERN = /^Bearer [A-Za-z0-9_-]{43}$/i;
const BEARER_PREFIX_LENGTH = "Bearer ".length;

export interface SessionUser {
    id: number; // internal only; never put in a response
    displayName: string;
    discriminator: number;
    emailVerified: boolean;
}

export interface AuthenticatedSession {
    sessionId: number;
    user: SessionUser;
}

function unauthorized(res: Response, code: string, message: string): HttpError {
    // RFC 6750: a 401 from a bearer-token endpoint must name the scheme.
    res.set("WWW-Authenticate", "Bearer");
    return new HttpError(401, code, message);
}

// Call at the start of every protected handler. Throws a 401 HttpError if the request
// has no valid session.
export async function authenticate(req: Request, res: Response): Promise<AuthenticatedSession> {
    const header = req.get("Authorization");
    if (header === undefined) {
        throw unauthorized(res, "authentication_required", "This endpoint requires a logged-in user");
    }
    if (!BEARER_PATTERN.test(header)) {
        throw unauthorized(res, "invalid_token", "Session is invalid or expired; log in again");
    }
    const token = header.slice(BEARER_PREFIX_LENGTH);

    const session = await prisma.session
        .findUnique({
            where: { tokenHash: hashToken(token) },
            select: {
                id: true,
                expiresAt: true,
                user: { select: { id: true, displayName: true, discriminator: true, emailVerifiedAt: true } },
            },
        })
        .catch((err: unknown) => {
            throw new Error(`Session lookup failed: ${describeError(err)}`);
        });

    if (session === null || session.expiresAt <= new Date()) {
        throw unauthorized(res, "invalid_token", "Session is invalid or expired; log in again");
    }
    return {
        sessionId: session.id,
        user: {
            id: session.user.id,
            displayName: session.user.displayName,
            discriminator: session.user.discriminator,
            emailVerified: session.user.emailVerifiedAt !== null,
        },
    };
}

// The user object in API responses (login, /auth/me). Built field by field; no id.
export function userResponse(user: Omit<SessionUser, "id">) {
    return {
        displayName: user.displayName,
        discriminator: user.discriminator,
        emailVerified: user.emailVerified,
    };
}