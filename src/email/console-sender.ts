import type { EmailMessage, EmailSender } from "./sender.js";

export class ConsoleEmailSender implements EmailSender{
    async send (message: EmailMessage): Promise<void>{
        console.log([
            "----- email (console sender, NOT delivered) -----",
            `To: ${message.to}`,
            `Subject: ${message.subject}`,
            "",
            message.text,
            "--------------------------------------------------",
        ].join("\n"));
    }
}