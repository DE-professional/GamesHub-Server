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
})
.refine(
    (env)=>
        !env.DB_ALLOW_PUBLIC_KEY_RETRIEVAL || LOCAL_HOSTS.has(new URL(env.DATABASE_URL).hostname),
    {
        message: "DB_ALLOW_PUBLIC_KEY_RETRIEVAL may only be enabled for a local database",
        path: ["DB_ALLOW_PUBLIC_KEY_RETRIEVAL"],
    },
);

export const config = envSchema.parse(process.env);