-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mcqEloRating" INTEGER NOT NULL DEFAULT 1000;

-- CreateTable
CREATE TABLE "McqMatch" (
    "id" TEXT NOT NULL,
    "player1Id" TEXT NOT NULL,
    "player2Id" TEXT NOT NULL,
    "winnerId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "player1Score" INTEGER NOT NULL DEFAULT 0,
    "player2Score" INTEGER NOT NULL DEFAULT 0,
    "totalRounds" INTEGER NOT NULL DEFAULT 10,

    CONSTRAINT "McqMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "McqMatch_player1Id_idx" ON "McqMatch"("player1Id");

-- CreateIndex
CREATE INDEX "McqMatch_player2Id_idx" ON "McqMatch"("player2Id");

-- CreateIndex
CREATE INDEX "McqMatch_winnerId_idx" ON "McqMatch"("winnerId");

-- AddForeignKey
ALTER TABLE "McqMatch" ADD CONSTRAINT "McqMatch_player1Id_fkey" FOREIGN KEY ("player1Id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McqMatch" ADD CONSTRAINT "McqMatch_player2Id_fkey" FOREIGN KEY ("player2Id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McqMatch" ADD CONSTRAINT "McqMatch_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
