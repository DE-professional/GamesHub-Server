import {config} from "../config.js";
import { issueToken, type IssuedToken } from "./token.js";
import { createHash, randomBytes } from "node:crypto";

export const VERIFICATION_TOKEN_TTL_HOURS = 24;

// The raw token goes only into the email link. The database stores its SHA-256 hash.
export function createVerificationToken(): IssuedToken {
    return issueToken(VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000);
}

export function buildVerificationUrl(token:string):string{
    const url = new URL(config.EMAIL_VERIFICATION_URL);
    url.searchParams.set("token", token);
    return url.toString();
}