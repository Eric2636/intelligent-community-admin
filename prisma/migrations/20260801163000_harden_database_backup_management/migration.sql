ALTER TABLE `database_backup_jobs`
    ADD COLUMN `activeKey` VARCHAR(32) NULL,
    ADD COLUMN `scheduledAt` DATETIME(3) NULL,
    ADD COLUMN `durationMs` INTEGER NULL;

UPDATE `database_backup_jobs`
SET `scheduledAt` = `createdAt`
WHERE `scheduledAt` IS NULL;

ALTER TABLE `database_backup_jobs`
    MODIFY COLUMN `scheduledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD UNIQUE INDEX `database_backup_jobs_activeKey_key`(`activeKey`);

CREATE TABLE `database_backup_leases` (
    `environment` VARCHAR(32) NOT NULL,
    `ownerToken` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX `database_backup_leases_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`environment`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
