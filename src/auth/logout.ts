import type { RequestHandler } from "express";
import { prisma } from "../db.js";
import { describeError } from "../errors.js";
import { authenticate } from "./sessions.js";

export const logout: RequestHandler = async (req, res) => {
    const { sessionId } = await authenticate(req, res);
    // deleteMany: a concurrent logout with the same token finds nothing instead of throwing.
    await prisma.session.deleteMany({ where: { id: sessionId } }).catch((err: unknown) => {
        throw new Error(`Logout failed: ${describeError(err)}`);
    });
    res.status(204).end();
};