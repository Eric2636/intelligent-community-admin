-- 用户标签仅由 User.identityType 与当前 AdminUser.boundUserId 实时计算。
-- 内容表不再保留身份/管理员标签快照，避免身份变更后显示陈旧标签。
ALTER TABLE `Task`
  DROP COLUMN IF EXISTS `publisherIdentity`,
  DROP COLUMN IF EXISTS `adminLabel`;

ALTER TABLE `forum_posts`
  DROP COLUMN IF EXISTS `authorIdentity`,
  DROP COLUMN IF EXISTS `adminLabel`;

ALTER TABLE `forum_replies`
  DROP COLUMN IF EXISTS `authorIdentity`;

ALTER TABLE `mall_items`
  DROP COLUMN IF EXISTS `adminLabel`;

-- 管理员绑定关系是用户标签的唯一管理员来源，禁止多个管理员绑定同一用户。
DROP INDEX IF EXISTS `AdminUser_boundUserId_key` ON `AdminUser`;
DROP INDEX IF EXISTS `AdminUser_boundUserId_idx` ON `AdminUser`;
CREATE UNIQUE INDEX `AdminUser_boundUserId_key` ON `AdminUser`(`boundUserId`);
