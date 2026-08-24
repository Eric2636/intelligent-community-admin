ALTER TABLE `forum_posts`
  ADD COLUMN `featureType` ENUM('CONTENT', 'REGISTRATION') NOT NULL DEFAULT 'CONTENT';

CREATE INDEX `forum_posts_featureType_visibility_createdAt_idx`
  ON `forum_posts`(`featureType`, `visibility`, `createdAt`);

CREATE TABLE `forum_post_registrations` (
  `postId` VARCHAR(191) NOT NULL,
  `capacity` INTEGER NOT NULL,
  `deadlineAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`postId`),
  INDEX `forum_post_registrations_deadlineAt_idx`(`deadlineAt`),
  CONSTRAINT `forum_post_registrations_postId_fkey`
    FOREIGN KEY (`postId`) REFERENCES `forum_posts`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `forum_post_registration_entries` (
  `id` VARCHAR(191) NOT NULL,
  `postId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `forum_post_registration_entries_postId_userId_key`(`postId`, `userId`),
  INDEX `forum_post_registration_entries_postId_createdAt_idx`(`postId`, `createdAt`),
  CONSTRAINT `forum_post_registration_entries_postId_fkey`
    FOREIGN KEY (`postId`) REFERENCES `forum_post_registrations`(`postId`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
