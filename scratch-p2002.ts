import { prisma } from "./src/db.js";
import { Prisma } from "./src/generated/prisma/client.js";

const base = { passwordHash: "not-a-real-hash", displayName: "p2002_test", discriminator: 1000 };

async function attempt(label: string, data: typeof base & { email: string }) {
    try {
        await prisma.user.create({ data });
        console.log(`${label}: inserted`);
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
            console.log(`${label}: ${err.code}`);
            console.log("message:", err.message);
            console.dir(err.meta, { depth: null });
        } else {
            console.log(`${label}: unexpected error`, err);
        }
    }
}

try {
    await attempt("first insert", { ...base, email: "p2002-a@example.com" });
    // Same address in different case, different tag: only the email index should fail.
    await attempt("same email", { ...base, email: "P2002-A@example.com", discriminator: 1001 });
    // Different address, same tag: only the tag index should fail.
    await attempt("same tag", { ...base, email: "p2002-b@example.com" });
} finally {
    await prisma.user.deleteMany({ where: { displayName: "p2002_test" } });
    await prisma.$disconnect();
}