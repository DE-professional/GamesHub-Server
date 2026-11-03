import type { RequestHandler } from "express";
import { authenticate, userResponse } from "./sessions.js";

export const me: RequestHandler = async (req, res) => {
    const { user } = await authenticate(req, res);
    res.json({ user: userResponse(user) });
};