-- Optional opaque player id from the browser (UUID). Null on older rows.
ALTER TABLE scores ADD COLUMN client_id TEXT;

CREATE INDEX IF NOT EXISTS idx_scores_client_id ON scores (client_id);
