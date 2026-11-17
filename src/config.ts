import {z} from "zod";

try{
    process.loadEnvFile();
} catch(err){
    if((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// A browser origin: scheme, host and optional port, nothing else ("https://html.itch.zone").
// https only, except for local hosts (a local WebGL build is served over http).
function isAllowedOriginSyntax(value: string): boolean {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    if (url.origin !== value) return false; // rejects paths, trailing slashes, credentials, uppercase
    return url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
}
const envSchema = z.object({
    DATABASE_URL: z.url({protocol: /^mysql$/}),
    PORT: z.coerce.number().int().min(1).max(65535).default(3900),
    DB_ALLOW_PUBLIC_KEY_RETRIEVAL: z.stringbool().default(false),
    EMAIL_TRANSPORT: z.enum(["console"]),
    EMAIL_VERIFICATION_URL: z.url({protocol: /^https?$/}),
    // Steam Web API key, used to fetch the app list for Price Is Nice. Server-side only: never
    // send it to clients. Optional so teammates can run the server without one: when unset (or
    // empty), the puzzle endpoint answers 503 puzzle_unavailable.
    STEAM_API_KEY: z.preprocess(
        (value) => (value === "" ? undefined : value),
        z.string().regex(/^[A-Za-z0-9]{16,64}$/).optional(),
    ),
    // Web pages allowed to call the API from a browser (the WebGL build): comma-separated exact
    // origins. Empty (the default) sends no CORS headers; the Unity Editor doesn't need any.
    CORS_ORIGINS: z
        .string()
        .default("")
        .transform((value) => value.split(",").map((origin) => origin.trim()).filter((origin) => origin !== ""))
        .pipe(
            z.array(
                z.string().refine(isAllowedOriginSyntax, {
                    message:
                        "each CORS_ORIGINS entry must be an origin like https://example.com " +
                        "(no path or trailing slash; http only for localhost)",
                }),
            ),
        ),
    // Development only: also allow http://localhost on any port, for Unity's WebGL "Build and Run",
    // whose port changes between runs.
    CORS_ALLOW_LOCALHOST: z.stringbool().default(false),

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
).refine(
    (env) => !env.CORS_ALLOW_LOCALHOST || LOCAL_HOSTS.has(new URL(env.DATABASE_URL).hostname),
    {
        message: "CORS_ALLOW_LOCALHOST may only be enabled for a local database",
        path: ["CORS_ALLOW_LOCALHOST"],
    },
);

export const config = envSchema.parse(process.env);