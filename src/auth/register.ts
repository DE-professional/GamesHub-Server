import { randomInt } from "node:crypto";
import type { RequestHandler, Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { emailSender, type EmailMessage } from "../email/index.js";
import { registrationAttemptEmail, verificationEmail } from "../email/templates.js";
import { describeError, HttpError, uniqueViolationIndex } from "../errors.js";
import { hashPassword } from "./password.js";
import { buildVerificationUrl, createVerificationToken, VERIFICATION_TOKEN_TTL_HOURS } from "./verification.js";

const EMAIL_INDEX = "users_email_key";
const TAG_INDEX = "users_display_name_discriminator_key";
const MAX_TAG_ATTEMPTS = 5;

const registerSchema = z.object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    password: z.string().refine((pw)=>{
        const length = [...pw].length;
        return length >= 12 && length <= 128;
    }),
    displayName: z.string().regex(/^[A-Za-z0-9_]{3,16}$/),
});

const FIELD_ERRORS = new Map([
    ["email", {code: "invalid_email", message: "Enter a valid email address"}],
    ["password", {code:"invalid_password", message: "Password must be 12-128 characters"}],
    ["displayName",{code:"invalid_display_name", message:"Display name must be 3-16 letters, digits, or underscores"}]
]);

function sendInBackground(message: EmailMessage): void{
    emailSender.send(message).catch((err:unknown)=>{
        console.error(`Email send failed: ${describeError(err)}`);
    });
}

function respondAccepted(res:Response): void{
    res.status(202).json({status: "check_email"});
}

export const register: RequestHandler = async (req,res) =>{
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success){
        const field = parsed.error.issues[0]?.path[0];
        const fieldError = typeof field === "string" ? FIELD_ERRORS.get(field) : undefined;
        if (fieldError){
            throw new HttpError(400, fieldError.code, fieldError.message);
        }
        throw new HttpError(400, "invalid_body", "Body must be a JSON object with email, password, and displayName");
    }
    const {email,password,displayName} = parsed.data;

    // Both paths (new and existing email) pay for the hash, so timing doesn't reveal accounts.
    const passwordHash = await hashPassword(password);
    const {token, tokenHash, expiresAt} = createVerificationToken();

    for(let attempt = 0; attempt < MAX_TAG_ATTEMPTS; attempt++){
        let violatedIndex: string | undefined;
        try{
            await prisma.user.create({
                data:{
                    email,
                    passwordHash,
                    displayName,
                    discriminator: randomInt(1000,10000),
                    emailVerificationTokens: { create: {tokenHash, expiresAt}},
                },
                select: {id:true},
            })
        }catch(err){
            violatedIndex = uniqueViolationIndex(err);
            if(violatedIndex === undefined){
                throw new Error(`Registration insert failed: ${describeError(err)}`);
            }
        }
        if(violatedIndex === undefined){
            respondAccepted(res);
            sendInBackground(verificationEmail(email, buildVerificationUrl(token), VERIFICATION_TOKEN_TTL_HOURS));
            return;
        }
        if(violatedIndex === EMAIL_INDEX){
            respondAccepted(res);
            sendInBackground(registrationAttemptEmail(email));
            return;
        }
        if(violatedIndex !== TAG_INDEX){
            throw new Error(`Registration insert violated an unexpected unique index: ${violatedIndex}`);
        }
        // Tag already taken: loop and try another discriminator.

    }
    let emailTaken: boolean;
    try{
        emailTaken = (await prisma.user.findUnique({where: {email}, select:{id:true}})) !== null;
    }catch(err){
        throw new Error(`Registration email lookup failed ${describeError(err)}`);
    }
    if(emailTaken){
        respondAccepted(res);
        sendInBackground(registrationAttemptEmail(email));
        return;
    }
    throw new HttpError(409, "display_name_unavailable", "That display name is too popular; choose another");
};


