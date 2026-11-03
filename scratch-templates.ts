import { randomBytes } from "node:crypto";
import { buildVerificationUrl } from "./src/auth/verification.js";
import { emailSender } from "./src/email/index.js";
import { registrationAttemptEmail, verificationEmail } from "./src/email/templates.js";

const token = randomBytes(32).toString("base64url");
await emailSender.send(verificationEmail("new@example.fun", buildVerificationUrl(token), 24));
await emailSender.send(registrationAttemptEmail("existing@example.com"));