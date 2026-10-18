-- AlterTable
ALTER TABLE "FalVideoJob" ADD COLUMN     "submissionKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "FalVideoJob_submissionKey_key" ON "FalVideoJob"("submissionKey");
