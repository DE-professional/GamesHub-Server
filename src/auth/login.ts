import { randomBytes } from "node:crypto";
import type { RequestHandler } from "express";
import { discriminatedUnion, z } from "zod";
import { prisma } from "../db.js";
import { describeError, HttpError } from "../errors.js";
import { hashPassword, passwordNeedsRehash, verifyPassword } from "./password.js";
import { createSessionToken, userResponse } from "./sessions.js";
const loginSchema = z.object({
    email: z.string().trim().toLowerCase(),
    password: z.string(),
});

// Verified against when the email has no account, so both paths cost one argon2 verify and
// response time doesn't reveal which emails are registered. Created with the current settings,
// so it costs the same as verifying a current user hash.
const DUMMY_HASH = await hashPassword(randomBytes(32).toString("base64url"));

function invalidCredentials(): HttpError{
    return new HttpError(401, "invalid_credentials", "Email or password is incorrect");
}

export const login: RequestHandler = async (req,res) =>{
    const parsed = loginSchema.safeParse(req.body);
    if(!parsed.success){
        throw new HttpError(400, "invalid_body", "Body must be a JSON object with email and password");
    }
    const {email,password} = parsed.data;

    const user = await prisma.user
    .findUnique({
        where: {email},
        select: {id: true, passwordHash: true, displayName: true, discriminator: true, emailVerifiedAt: true}
    })
    .catch((err:unknown) =>{
        throw new Error(`Login lookup failed: ${describeError(err)}`);
    })
    const passwordValid = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, password);
    if (user === null || !passwordValid) {
        throw invalidCredentials();
    }
    if (passwordNeedsRehash(user.passwordHash)) {
        const newHash = await hashPassword(password);
        // Only replaces the hash that was verified: a password reset in between must not be undone.
        await prisma.user
            .updateMany({ where: { id: user.id, passwordHash: user.passwordHash }, data: { passwordHash: newHash } })
            .catch((err: unknown) => {
                console.error(`Password rehash failed: ${describeError(err)}`);
            });
    }
    const {token, tokenHash, expiresAt} = createSessionToken();
    await prisma
    .$transaction([
        prisma.session.deleteMany({where:{userId: user.id, expiresAt:{lte: new Date()}}}),
        prisma.session.create({data:{userId:user.id,tokenHash,expiresAt}, select:{id:true}}),
    ])
    .catch((err: unknown)=>{
        throw new Error(`Session create failed: ${describeError(err)}`);
    })
    res.set("Cache-Control", "no-store");
    res.status(200).json({
        token,
        expiresAt: expiresAt.toISOString(),
        user: userResponse({
            displayName: user.displayName,
            discriminator: user.discriminator,
            emailVerified: user.emailVerifiedAt !== null,
        }),
    });
}