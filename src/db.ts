import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./generated/prisma/client.js";
import {config} from "./config.js";

const url = new URL(config.DATABASE_URL);

const adapter = new PrismaMariaDb({
    host:url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    // Pool settings, set deliberately (see below).
    connectionLimit: 10,
    connectTimeout: 5_000, // ms
    idleTimeout: 300,      // seconds, not ms
    allowPublicKeyRetrieval: config.DB_ALLOW_PUBLIC_KEY_RETRIEVAL,
});

export const prisma = new PrismaClient({adapter});