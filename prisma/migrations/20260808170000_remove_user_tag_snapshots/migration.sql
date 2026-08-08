-- 用户标签仅由 User.identityType 与当前 AdminUser.boundUserId 实时计算。
-- 内容表不再保留身份/管理员标签快照，避免身份变更后显示陈旧标签。
-- 该迁移曾在测试库中途失败；使用 information_schema + 动态 SQL，保证可从中断处安全继续。
SET @drop_column_table = 'Task';
SET @drop_column_name = 'publisherIdentity';
SET @drop_column_sql = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @drop_column_table AND COLUMN_NAME = @drop_column_name), CONCAT('ALTER TABLE `', @drop_column_table, '` DROP COLUMN `', @drop_column_name, '`'), 'SELECT 1'));
PREPARE statement FROM @drop_column_sql;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @drop_column_table = 'Task';
SET @drop_column_name = 'adminLabel';
SET @drop_column_sql = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @drop_column_table AND COLUMN_NAME = @drop_column_name), CONCAT('ALTER TABLE `', @drop_column_table, '` DROP COLUMN `', @drop_column_name, '`'), 'SELECT 1'));
PREPARE statement FROM @drop_column_sql;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @drop_column_table = 'forum_posts';
SET @drop_column_name = 'authorIdentity';
SET @drop_column_sql = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @drop_column_table AND COLUMN_NAME = @drop_column_name), CONCAT('ALTER TABLE `', @drop_column_table, '` DROP COLUMN `', @drop_column_name, '`'), 'SELECT 1'));
PREPARE statement FROM @drop_column_sql;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @drop_column_table = 'forum_posts';
SET @drop_column_name = 'adminLabel';
SET @drop_column_sql = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @drop_column_table AND COLUMN_NAME = @drop_column_name), CONCAT('ALTER TABLE `', @drop_column_table, '` DROP COLUMN `', @drop_column_name, '`'), 'SELECT 1'));
PREPARE statement FROM @drop_column_sql;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @drop_column_table = 'forum_replies';
SET @drop_column_name = 'authorIdentity';
SET @drop_column_sql = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @drop_column_table AND COLUMN_NAME = @drop_column_name), CONCAT('ALTER TABLE `', @drop_column_table, '` DROP COLUMN `', @drop_column_name, '`'), 'SELECT 1'));
PREPARE statement FROM @drop_column_sql;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @drop_column_table = 'mall_items';
SET @drop_column_name = 'adminLabel';
SET @drop_column_sql = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @drop_column_table AND COLUMN_NAME = @drop_column_name), CONCAT('ALTER TABLE `', @drop_column_table, '` DROP COLUMN `', @drop_column_name, '`'), 'SELECT 1'));
PREPARE statement FROM @drop_column_sql;
EXECUTE statement;
DEALLOCATE PREPARE statement;

-- 管理员绑定关系是用户标签的唯一管理员来源，禁止多个管理员绑定同一用户。
SET @drop_index_name = 'AdminUser_boundUserId_key';
SET @drop_index_sql = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'AdminUser' AND INDEX_NAME = @drop_index_name), CONCAT('DROP INDEX `', @drop_index_name, '` ON `AdminUser`'), 'SELECT 1'));
PREPARE statement FROM @drop_index_sql;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @drop_index_name = 'AdminUser_boundUserId_idx';
SET @drop_index_sql = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'AdminUser' AND INDEX_NAME = @drop_index_name), CONCAT('DROP INDEX `', @drop_index_name, '` ON `AdminUser`'), 'SELECT 1'));
PREPARE statement FROM @drop_index_sql;
EXECUTE statement;
DEALLOCATE PREPARE statement;

CREATE UNIQUE INDEX `AdminUser_boundUserId_key` ON `AdminUser`(`boundUserId`);
