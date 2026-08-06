-- How a credential authenticates. Existing rows hold OAuth fields, so API is
-- the correct backfill: the default is what they already were.
CREATE TYPE "CredentialAuthMethod" AS ENUM ('API', 'BROWSER');

ALTER TABLE "credentials"
  ADD COLUMN "auth_method" "CredentialAuthMethod" NOT NULL DEFAULT 'API';
