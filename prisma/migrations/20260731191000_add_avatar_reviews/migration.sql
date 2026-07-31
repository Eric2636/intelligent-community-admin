CREATE TABLE `avatar_reviews` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `mediaUrl` TEXT NOT NULL,
    `traceId` VARCHAR(191) NULL,
    `status` VARCHAR(24) NOT NULL,
    `suggest` VARCHAR(24) NULL,
    `label` INTEGER NULL,
    `wechatErrcode` INTEGER NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `avatar_reviews_traceId_key`(`traceId`),
    INDEX `avatar_reviews_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `avatar_reviews_userId_status_createdAt_idx`(`userId`, `status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
