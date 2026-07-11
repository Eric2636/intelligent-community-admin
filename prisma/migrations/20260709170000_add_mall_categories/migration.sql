CREATE TABLE `mall_categories` (
  `id` VARCHAR(64) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `mall_categories_enabled_sortOrder_idx` (`enabled`, `sortOrder`),
  INDEX `mall_categories_sortOrder_idx` (`sortOrder`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `mall_categories` (`id`, `name`, `sortOrder`, `enabled`)
VALUES
  ('flea', '跳蚤市场', 10, true),
  ('rental', '小区租房', 20, true),
  ('personal_store', '个人店铺', 30, true)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `sortOrder` = VALUES(`sortOrder`),
  `enabled` = VALUES(`enabled`);
