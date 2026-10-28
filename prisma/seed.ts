import {PrismaClient} from "@prisma/client";

const prisma = new PrismaClient();

async function main(){
    await prisma.game.upsert({
        where:{slug:"minesweeper"},
        update:{name:"Minesweeper"},
        create:{slug:"minesweeper", name:"Minesweeper"}
    });
    await prisma.game.upsert({
        where:{slug:"blackjack"},
        update:{name:"Blackjack"},
        create:{slug:"blackjack", name:"Blackjack"}
    });
    await prisma.game.upsert({
        where:{slug:"price-is-nice"},
        update:{name:"Price Is Nice"},
        create:{slug:"price-is-nice", name:"Price Is Nice"}
    });
    await prisma.game.upsert({
        where:{slug:"runner"},
        update:{name:"Runner"},
        create:{slug:"runner", name:"Runner"}
    });
    await prisma.game.upsert({
        where:{slug:"sudoku"},
        update:{name:"Sudoku"},
        create:{slug:"sudoku", name:"Sudoku"}
    });
    console.log("Seeded Games");

}
main()
    .catch((err)=>{
        console.error(err);
        process.exitCode=1;
    })
    .finally(()=>prisma.$disconnect());
