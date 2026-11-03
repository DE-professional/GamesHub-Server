import type {EmailMessage} from "./sender.js";

export function verificationEmail(to:string, verificationUrl:string, expiresInHours: number):EmailMessage{
    return{
        to,
        subject: "Verify your GamesHub email address",
        text: [
            "Welcome to GamesHub!",
            "",
            "To confirm your email address, click on the link below:",
            "",
            verificationUrl,
            "",
            `This link expires in ${expiresInHours} hours.`,
            "",
            "If you didn't create a GamesHub account, please ignore this email. Thanks!"

        ].join("\n")
    };
}
export function registrationAttemptEmail(to:string): EmailMessage{
    return{
        to,
        subject: "Someone tried to register with your email address",
        text:[
            "Someone tried to create a GamesHub account with this email address,",
            "but it already has an account.",
            "",
            "If this was you, log in with your existing account instead.",
            "",
            "If it wasn't you, you don't need to do anything. Your account has not been changed.",
        ].join("/n")
    };
}