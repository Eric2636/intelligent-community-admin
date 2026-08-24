ALTER TABLE `media_assets`
  ADD COLUMN `originalName` VARCHAR(255) NULL,
  ADD COLUMN `contentType` VARCHAR(191) NULL,
  ADD COLUMN `sizeBytes` INTEGER NULL,
  MODIFY COLUMN `mediaType` ENUM('IMG', 'VID', 'FILE') NOT NULL;

CREATE TABLE `forum_post_attachments` (
  `id` VARCHAR(191) NOT NULL,
  `postId` VARCHAR(191) NOT NULL,
  `mediaAssetId` VARCHAR(191) NOT NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `forum_post_attachments_mediaAssetId_key`(`mediaAssetId`),
  INDEX `forum_post_attachments_postId_sortOrder_idx`(`postId`, `sortOrder`),
  CONSTRAINT `forum_post_attachments_postId_fkey`
    FOREIGN KEY (`postId`) REFERENCES `forum_posts`(`id`) ON DELETE CASCADE,
  CONSTRAINT `forum_post_attachments_mediaAssetId_fkey`
    FOREIGN KEY (`mediaAssetId`) REFERENCES `media_assets`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
