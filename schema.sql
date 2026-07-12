-- AgentMcpLab D1 schema
CREATE TABLE IF NOT EXISTS sessions (
  session_id   TEXT PRIMARY KEY,
  runner       TEXT NOT NULL,
  page         TEXT NOT NULL,
  user_agent   TEXT,
  bot_score    INTEGER NOT NULL DEFAULT 0,
  verdict      TEXT NOT NULL DEFAULT 'pass',
  network      TEXT,           -- JSON NetworkFingerprint
  results      TEXT NOT NULL,  -- JSON TestResult[]
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_runner  ON sessions(runner);
CREATE INDEX IF NOT EXISTS idx_sessions_page    ON sessions(page);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);
