import { Router } from "express";
import { login } from "./login.js";
import { logout } from "./logout.js";
import { me } from "./me.js";
import { register } from "./register.js";
import { requireJson } from "../middleware.js";
export const authRouter = Router();

authRouter.post("/register", requireJson, register);
authRouter.post("/login", requireJson, login);
authRouter.get("/me", me);
authRouter.post("/logout", logout);