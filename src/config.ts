import {z} from "zod";

try{
    process.loadEnvFile();
} catch(err){
    if((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}

const envSchema = z.object({
    DATABASE_URL: z.string().min(1),
    PORT: z.coerce.number().int().min(1).max(65535).default(3900),
});

export const config = envSchema.parse(process.env);