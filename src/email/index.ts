import { create } from "domain";
import { config } from "../config.js";
import { ConsoleEmailSender } from "./console-sender.js";
import { EmailSender } from "./sender.js";

export type {EmailMessage, EmailSender} from "./sender.js"

function createEmailSender(): EmailSender{
    switch(config.EMAIL_TRANSPORT){
        case "console":
            return new ConsoleEmailSender();
    }
}

export const emailSender = createEmailSender();