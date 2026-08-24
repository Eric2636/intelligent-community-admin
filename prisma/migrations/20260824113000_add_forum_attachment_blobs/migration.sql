CREATE TABLE `forum_attachment_blobs` (
  `id` VARCHAR(191) NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `objectKey` VARCHAR(512) NOT NULL,
  `url` TEXT NOT NULL,
  `contentType` VARCHAR(191) NOT NULL,
  `sizeBytes` INTEGER NOT NULL,
  `deleteRequestedAt` DATETIME(3) NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `forum_attachment_blobs_sha256_key`(`sha256`),
  UNIQUE INDEX `forum_attachment_blobs_objectKey_key`(`objectKey`),
  INDEX `forum_attachment_blobs_deleteRequestedAt_idx`(`deleteRequestedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `media_assets`
  ADD COLUMN `forumAttachmentBlobId` VARCHAR(191) NULL,
  ADD INDEX `media_assets_forumAttachmentBlobId_idx`(`forumAttachmentBlobId`),
  ADD CONSTRAINT `media_assets_forumAttachmentBlobId_fkey`
    FOREIGN KEY (`forumAttachmentBlobId`) REFERENCES `forum_attachment_blobs`(`id`) ON DELETE SET NULL;
