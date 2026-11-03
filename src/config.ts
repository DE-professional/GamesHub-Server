import {z} from "zod";

try{
    process.loadEnvFile();
} catch(err){
    if((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const envSchema = z.object({
    DATABASE_URL: z.url({protocol: /^mysql$/}),
    PORT: z.coerce.number().int().min(1).max(65535).default(3900),
    DB_ALLOW_PUBLIC_KEY_RETRIEVAL: z.stringbool().default(false),
    EMAIL_TRANSPORT: z.enum(["console"]),
    EMAIL_VERIFICATION_URL: z.url({protocol: /^https?$/})

})
.refine(
    (env)=>
        !env.DB_ALLOW_PUBLIC_KEY_RETRIEVAL || LOCAL_HOSTS.has(new URL(env.DATABASE_URL).hostname),
    {
        message: "DB_ALLOW_PUBLIC_KEY_RETRIEVAL may only be enabled for a local database",
        path: ["DB_ALLOW_PUBLIC_KEY_RETRIEVAL"],
    },
).refine(
    (env) =>{
        const url = new URL(env.EMAIL_VERIFICATION_URL);
        return url.protocol === "https:" || LOCAL_HOSTS.has(url.hostname);
    },
    {
        message: "EMAIL_VERIFICATION_URL must use https unless it points at a local host",
        path: ["EMAIL_VERIFICATION_URL"],
    },
);

export const config = envSchema.parse(process.env);