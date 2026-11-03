import {createHash, randomBytes} from "node:crypto";

export interface IssuedToken{
    token:string;
    tokenHash: Uint8Array<ArrayBuffer>;
    expiresAt: Date;
}

export function issueToken(ttlMs: number): IssuedToken{
    const token = randomBytes(32).toString("base64url");
    return {token, tokenHash:hashToken(token), expiresAt: new Date(Date.now() + ttlMs)};
}

export function hashToken(token:string): Uint8Array<ArrayBuffer>{
    return createHash("sha256").update(token).digest();
}