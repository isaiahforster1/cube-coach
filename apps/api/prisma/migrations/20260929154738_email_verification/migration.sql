-- Email verification.
--
-- email_verified_at records when an address was proved to belong to its account. Null
-- means it never was, which is how every password account starts. Tokens are stored
-- hashed, like session tokens, and deleted when the user is.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_id_idx" ON "email_verification_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: an account already linked to Google had its address proved by Google, which
-- refuses to sign in with an unverified email (ADR-0013). Password-only accounts stay
-- unverified; nothing has ever proved their address, and pretending otherwise would let
-- an old unproved password survive a Google link.
UPDATE "users" SET "email_verified_at" = CURRENT_TIMESTAMP WHERE "google_id" IS NOT NULL;
