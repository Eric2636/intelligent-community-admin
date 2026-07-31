CREATE TABLE `api_endpoints` (
    `id` VARCHAR(191) NOT NULL,
    `source` VARCHAR(24) NOT NULL,
    `method` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `routePattern` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `description` VARCHAR(500) NULL,
    `logEnabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `api_endpoints_method_routePattern_key`(`method`, `routePattern`),
    INDEX `api_endpoints_source_logEnabled_idx`(`source`, `logEnabled`),
    INDEX `api_endpoints_updatedAt_idx`(`updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `api_access_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `endpointId` VARCHAR(191) NULL,
    `source` VARCHAR(24) NOT NULL,
    `method` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `routePattern` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `path` VARCHAR(1024) NOT NULL,
    `ip` VARCHAR(64) NULL,
    `userId` VARCHAR(191) NULL,
    `adminId` VARCHAR(191) NULL,
    `httpStatus` INTEGER NOT NULL,
    `businessCode` INTEGER NULL,
    `durationMs` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `api_access_logs_createdAt_idx`(`createdAt`),
    INDEX `api_access_logs_ip_createdAt_idx`(`ip`, `createdAt`),
    INDEX `api_access_logs_endpointId_createdAt_idx`(`endpointId`, `createdAt`),
    INDEX `api_access_logs_method_createdAt_idx`(`method`, `createdAt`),
    INDEX `api_access_logs_source_createdAt_idx`(`source`, `createdAt`),
    INDEX `api_access_logs_httpStatus_createdAt_idx`(`httpStatus`, `createdAt`),
    INDEX `api_access_logs_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `api_access_logs_adminId_createdAt_idx`(`adminId`, `createdAt`),
    INDEX `api_access_logs_durationMs_createdAt_idx`(`durationMs`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `api_error_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `endpointId` VARCHAR(191) NULL,
    `source` VARCHAR(24) NOT NULL,
    `method` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `routePattern` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `path` VARCHAR(1024) NOT NULL,
    `ip` VARCHAR(64) NULL,
    `userId` VARCHAR(191) NULL,
    `adminId` VARCHAR(191) NULL,
    `httpStatus` INTEGER NOT NULL,
    `errorCode` VARCHAR(96) NULL,
    `errorSummary` TEXT NOT NULL,
    `durationMs` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `api_error_logs_createdAt_idx`(`createdAt`),
    INDEX `api_error_logs_ip_createdAt_idx`(`ip`, `createdAt`),
    INDEX `api_error_logs_endpointId_createdAt_idx`(`endpointId`, `createdAt`),
    INDEX `api_error_logs_method_createdAt_idx`(`method`, `createdAt`),
    INDEX `api_error_logs_source_createdAt_idx`(`source`, `createdAt`),
    INDEX `api_error_logs_httpStatus_createdAt_idx`(`httpStatus`, `createdAt`),
    INDEX `api_error_logs_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `api_error_logs_adminId_createdAt_idx`(`adminId`, `createdAt`),
    INDEX `api_error_logs_durationMs_createdAt_idx`(`durationMs`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
