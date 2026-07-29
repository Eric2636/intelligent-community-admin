ALTER TABLE admin_system_logs ADD COLUMN moduleKey VARCHAR(64) NULL;
CREATE INDEX admin_system_logs_adminId_moduleKey_createdAt_idx
  ON admin_system_logs (adminId, moduleKey, createdAt);
