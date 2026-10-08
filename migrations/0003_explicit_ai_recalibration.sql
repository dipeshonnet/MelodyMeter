ALTER TABLE generation_jobs ADD COLUMN refresh_requested INTEGER NOT NULL DEFAULT 0 CHECK(refresh_requested IN (0,1));
