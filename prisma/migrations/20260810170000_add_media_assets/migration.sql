CREATE TABLE `media_assets` (
    `id` VARCHAR(191) NOT NULL,
    `objectKey` VARCHAR(1024) NOT NULL,
    `url` TEXT NOT NULL,
    `uploaderId` VARCHAR(191) NOT NULL,
    `module` VARCHAR(32) NOT NULL,
    `mediaType` ENUM('IMG', 'VID') NOT NULL,
    `state` ENUM('PENDING', 'ATTACHED', 'DELETE_PENDING', 'DELETED', 'DELETE_FAILED') NOT NULL DEFAULT 'PENDING',
    `attachedAt` DATETIME(3) NULL,
    `deleteRequestedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `deleteAttempts` INTEGER NOT NULL DEFAULT 0,
    `lastDeleteError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `media_assets_objectKey_key`(`objectKey`),
    INDEX `media_assets_state_createdAt_idx`(`state`, `createdAt`),
    INDEX `media_assets_state_deleteRequestedAt_idx`(`state`, `deleteRequestedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
