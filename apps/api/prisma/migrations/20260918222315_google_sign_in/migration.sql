-- Google sign-in.
--
-- password_hash becomes nullable because an account that only signs in with Google
-- never has one. google_id is Google's stable subject identifier, deliberately not the
-- email: an email address can be reassigned by a workspace administrator, the subject
-- cannot.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "google_id" TEXT,
ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");
