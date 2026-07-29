-- This project did not previously have a notification model or notifications table.
-- Creating the new table preserves all existing business data.
ALTER TABLE `Task` ADD COLUMN `version` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `mall_orders` ADD COLUMN `version` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `mall_orders` ADD COLUMN `clientRequestId` VARCHAR(64) NULL;
UPDATE `mall_orders`
SET `clientRequestId` = CONCAT('legacy_', LEFT(SHA2(`id`, 256), 56))
WHERE `clientRequestId` IS NULL;
ALTER TABLE `mall_orders` MODIFY `clientRequestId` VARCHAR(64) NOT NULL;
CREATE UNIQUE INDEX `mall_orders_buyerId_clientRequestId_key` ON `mall_orders`(`buyerId`, `clientRequestId`);

CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `recipientId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `type` VARCHAR(48) NOT NULL,
    `bizType` VARCHAR(32) NOT NULL,
    `bizId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `dedupeKey` VARCHAR(255) NOT NULL,
    `readAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `notifications_recipientId_dedupeKey_key`(`recipientId`, `dedupeKey`),
    INDEX `notifications_recipientId_deletedAt_createdAt_idx`(`recipientId`, `deletedAt`, `createdAt`),
    INDEX `notifications_recipientId_readAt_deletedAt_idx`(`recipientId`, `readAt`, `deletedAt`),
    INDEX `notifications_bizType_bizId_idx`(`bizType`, `bizId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `system_notice_publications` (
    `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `adminId` VARCHAR(191) NOT NULL,
    `payloadHash` CHAR(64) NOT NULL,
    `recipientCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `system_notice_publications_adminId_createdAt_idx`(`adminId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
