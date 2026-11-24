import {prisma} from "../src/db.js";

// currentFormulaVersion: the version clients currently submit for the game. Leaderboards rank
// only scores with this version. Bump it here (and re-run the seed) when a formula changes.
const games = [
    { slug: "minesweeper", name: "Minesweeper", currentFormulaVersion: 1 },
    { slug: "blackjack", name: "Blackjack", currentFormulaVersion: 1 },
    { slug: "price-is-nice", name: "Price Is Nice", currentFormulaVersion: 1 },
    { slug: "runner", name: "Runner", currentFormulaVersion: 1 },
    { slug: "sudoku", name: "Sudoku", currentFormulaVersion: 1 },
];


async function main(){
    for (const game of games){
        await prisma.game.upsert({
            where:{slug: game.slug},
            update: {name: game.name, currentFormulaVersion: game.currentFormulaVersion},
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
