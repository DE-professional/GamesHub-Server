import {prisma} from "../src/db.js";

const games = [
    { slug: "minesweeper", name: "Minesweeper" },
    { slug: "blackjack", name: "Blackjack" },
    { slug: "price-is-nice", name: "Price Is Nice" },
    { slug: "runner", name: "Runner" },
    { slug: "sudoku", name: "Sudoku" },
];


async function main(){
    for (const game of games){
        await prisma.game.upsert({
            where:{slug: game.slug},
            update: {name: game.name},
            create: game,
        })
    }
    console.log(`Seeded ${games.length} games`);

}
main()
    .catch((err)=>{
        console.error(err);
        process.exitCode=1;
    })
    .finally(()=>prisma.$disconnect());
