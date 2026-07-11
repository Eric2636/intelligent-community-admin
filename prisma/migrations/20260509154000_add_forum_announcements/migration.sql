ALTER TABLE `forum_posts`
  ADD COLUMN `postType` ENUM('NORMAL', 'ANNOUNCEMENT') NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `validUntil` DATETIME(3) NULL;

CREATE INDEX `forum_posts_postType_visibility_validUntil_createdAt_idx`
  ON `forum_posts`(`postType`, `visibility`, `validUntil`, `createdAt`);
