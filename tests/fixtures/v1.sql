
          CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), password_hash TEXT, init_hash TEXT, config TEXT NOT NULL);
          CREATE TABLE items (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL UNIQUE COLLATE BINARY CHECK(length(title) BETWEEN 1 AND 200),
            claimant TEXT, claim_ip TEXT, claim_uuid TEXT, claimed_at INTEGER, completed_at INTEGER,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
            CHECK ((claimant IS NULL AND claim_ip IS NULL AND claim_uuid IS NULL AND claimed_at IS NULL AND completed_at IS NULL)
              OR (claimant IS NOT NULL AND length(claimant) BETWEEN 1 AND 60 AND claim_ip IS NOT NULL AND claim_uuid IS NOT NULL AND claimed_at IS NOT NULL))
          );
          CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
          CREATE TABLE attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
          PRAGMA user_version = 1;
        