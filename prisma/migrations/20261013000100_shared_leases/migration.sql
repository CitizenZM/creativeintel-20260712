CREATE TABLE "SharedLease" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "owner" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "SharedLease_expiresAt_idx" ON "SharedLease"("expiresAt");
