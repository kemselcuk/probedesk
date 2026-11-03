-- A session normally receives a CSRF token at login. The column is nullable so
-- /auth/me can issue one for a session that was created without it.
ALTER TABLE "sessions" ALTER COLUMN "csrfTokenHash" DROP NOT NULL;
