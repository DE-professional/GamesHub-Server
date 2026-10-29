import {defineConfig, env} from "prisma/config";

try{
    process.loadEnvFile();
} catch(err){
    if((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}

export default defineConfig({
    schema: "prisma/schema.prisma",
    migrations: {
        path:"prisma/migrations",
        seed: "tsx prisma/seed.ts",
    },
    datasource:{
        url: env("DATABASE_URL"),
    },
});