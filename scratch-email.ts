import {emailSender} from "./src/email/index.js"

await emailSender.send({to:"test@example.mail", subject:"wsg",text:"Line one\nLine two"});