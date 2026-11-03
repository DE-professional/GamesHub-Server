import {hashPassword, verifyPassword, passwordNeedsRehash} from "./src/auth/password.js";

const pw = "correct horse battery staple";
const start = performance.now();
const hash = await hashPassword(pw);
console.log(`hashed in ${Math.round(performance.now() - start)} ms`);
console.log("hash:", hash);
console.log("length:", hash.length);
console.log("same password, different hash:", hash !== (await hashPassword(pw)));
console.log("verify correct:", await verifyPassword(hash, pw));
console.log("verify wrong:", await verifyPassword(hash, pw + "x"));
console.log("needs rehash:", passwordNeedsRehash(hash));