import argon2 from "argon2";

// OWASP Password Storage Cheat Sheet, argon2id baseline: 19 MiB memory, 2 iterations, 1 lane.
// Raising these later is safe: hashes record their own parameters, and login rehashes
// old ones (see passwordNeedsRehash).

const HASH_OPTIONS = {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
} as const satisfies argon2.HashOptions;

export function hashPassword(password: string): Promise<string>{
    return argon2.hash(password.normalize("NFKC"), HASH_OPTIONS);
}
export function verifyPassword(hash: string, password: string): Promise<boolean>{
    return argon2.verify(hash,password.normalize("NFKC"));
}
export function passwordNeedsRehash(hash:string): boolean{
    return argon2.needsRehash(hash,HASH_OPTIONS);
}