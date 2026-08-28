-- V7__conversation_history.sql
-- Add query_text to snapshots so conversation history can be reconstructed.
-- Add conversation_message_json to sessions for full chat history persistence.

ALTER TABLE session_snapshots ADD COLUMN IF NOT EXISTS query_text TEXT;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS conversation_json TEXT;
