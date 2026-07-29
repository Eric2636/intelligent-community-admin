CREATE TABLE `api_request_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `requestId` VARCHAR(64) NOT NULL,
    `endpointId` VARCHAR(191) NULL,
    `source` VARCHAR(24) NOT NULL,
    `method` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `routePattern` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `requestUrl` TEXT NULL,
    `ip` VARCHAR(64) NULL,
    `userId` VARCHAR(191) NULL,
    `adminId` VARCHAR(191) NULL,
    `httpStatus` INTEGER NOT NULL,
    `businessCode` INTEGER NULL,
    `durationMs` INTEGER NOT NULL,
    `errorCode` VARCHAR(96) NULL,
    `errorSummary` TEXT NULL,
    `requestSnapshot` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `api_request_logs_createdAt_idx`(`createdAt`),
    INDEX `api_request_logs_requestId_idx`(`requestId`),
    INDEX `api_request_logs_ip_createdAt_idx`(`ip`, `createdAt`),
    INDEX `api_request_logs_endpointId_createdAt_idx`(`endpointId`, `createdAt`),
    INDEX `api_request_logs_method_createdAt_idx`(`method`, `createdAt`),
    INDEX `api_request_logs_source_createdAt_idx`(`source`, `createdAt`),
    INDEX `api_request_logs_httpStatus_createdAt_idx`(`httpStatus`, `createdAt`),
    INDEX `api_request_logs_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `api_request_logs_adminId_createdAt_idx`(`adminId`, `createdAt`),
    INDEX `api_request_logs_durationMs_createdAt_idx`(`durationMs`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `api_request_logs` (
    `requestId`, `endpointId`, `source`, `method`, `routePattern`, `requestUrl`, `ip`, `userId`, `adminId`,
    `httpStatus`, `businessCode`, `durationMs`, `errorCode`, `errorSummary`, `requestSnapshot`, `createdAt`
)
SELECT
    CONCAT('legacy-access-', `id`), `endpointId`, `source`, `method`, `routePattern`, NULL, `ip`, `userId`, `adminId`,
    `httpStatus`, `businessCode`, `durationMs`, NULL, NULL, NULL, `createdAt`
FROM `api_access_logs`;

INSERT INTO `api_request_logs` (
    `requestId`, `endpointId`, `source`, `method`, `routePattern`, `requestUrl`, `ip`, `userId`, `adminId`,
    `httpStatus`, `businessCode`, `durationMs`, `errorCode`, `errorSummary`, `requestSnapshot`, `createdAt`
)
SELECT
    CONCAT('legacy-error-', `id`), `endpointId`, `source`, `method`, `routePattern`, NULL, `ip`, `userId`, `adminId`,
    `httpStatus`, NULL, `durationMs`, `errorCode`, `errorSummary`, `requestSnapshot`, `createdAt`
FROM `api_error_logs`;

DROP TABLE `api_access_logs`;
DROP TABLE `api_error_logs`;
