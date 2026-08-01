CREATE TABLE `database_backup_settings` (
    `id` VARCHAR(32) NOT NULL DEFAULT 'default',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `frequency` ENUM('HOURLY', 'EVERY_6_HOURS', 'DAILY') NOT NULL DEFAULT 'HOURLY',
    `minute` INTEGER NOT NULL DEFAULT 5,
    `dailyHour` INTEGER NOT NULL DEFAULT 2,
    `lastScheduledAt` DATETIME(3) NULL,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `database_backup_jobs` (
    `id` VARCHAR(191) NOT NULL,
    `triggerType` ENUM('AUTO', 'MANUAL') NOT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `scheduleKey` VARCHAR(64) NULL,
    `environment` VARCHAR(32) NOT NULL,
    `requestedByAdminId` VARCHAR(191) NULL,
    `outputFileName` VARCHAR(255) NULL,
    `outputSizeBytes` BIGINT NULL,
    `errorMessage` TEXT NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `database_backup_jobs_scheduleKey_key`(`scheduleKey`),
    INDEX `database_backup_jobs_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `database_backup_jobs_triggerType_createdAt_idx`(`triggerType`, `createdAt`),
    INDEX `database_backup_jobs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `database_backup_settings` (`id`, `enabled`, `frequency`, `minute`, `dailyHour`)
VALUES ('default', true, 'HOURLY', 5, 2);
