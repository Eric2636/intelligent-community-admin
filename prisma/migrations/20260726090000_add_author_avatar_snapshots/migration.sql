ALTER TABLE `Task`
  ADD COLUMN `publisherAvatar` VARCHAR(191) NULL,
  ADD COLUMN `takerAvatar` VARCHAR(191) NULL;

ALTER TABLE `forum_replies`
  ADD COLUMN `authorAvatar` VARCHAR(191) NULL,
  ADD COLUMN `replyToUserId` VARCHAR(191) NULL,
  ADD INDEX `forum_replies_authorId_idx`(`authorId`),
  ADD INDEX `forum_replies_replyToUserId_idx`(`replyToUserId`);

ALTER TABLE `mall_items`
  ADD COLUMN `publisherName` VARCHAR(191) NULL,
  ADD COLUMN `publisherAvatar` VARCHAR(191) NULL;

ALTER TABLE `mall_item_comments`
  ADD COLUMN `authorName` VARCHAR(191) NULL,
  ADD COLUMN `authorAvatar` VARCHAR(191) NULL,
  ADD COLUMN `replyToUserId` VARCHAR(191) NULL,
  ADD INDEX `mall_item_comments_replyToUserId_idx`(`replyToUserId`);

ALTER TABLE `mall_orders`
  ADD COLUMN `sellerName` VARCHAR(191) NULL,
  ADD COLUMN `sellerAvatar` VARCHAR(191) NULL,
  ADD COLUMN `buyerName` VARCHAR(191) NULL,
  ADD COLUMN `buyerAvatar` VARCHAR(191) NULL;

UPDATE `Task` AS `task`
JOIN `User` AS `publisher` ON `publisher`.`id` = `task`.`publisherId`
SET
  `task`.`publisherName` = `publisher`.`name`,
  `task`.`publisherAvatar` = NULLIF(TRIM(`publisher`.`avatar`), ''),
  `task`.`publisherIdentity` = `publisher`.`identityType`;

UPDATE `Task` AS `task`
JOIN `User` AS `taker` ON `taker`.`id` = `task`.`takerId`
SET
  `task`.`takerName` = `taker`.`name`,
  `task`.`takerAvatar` = NULLIF(TRIM(`taker`.`avatar`), '');

UPDATE `forum_posts` AS `post`
JOIN `User` AS `author` ON `author`.`id` = `post`.`authorId`
SET
  `post`.`authorName` = `author`.`name`,
  `post`.`authorAvatar` = NULLIF(TRIM(`author`.`avatar`), ''),
  `post`.`authorIdentity` = `author`.`identityType`;

UPDATE `forum_replies` AS `reply`
JOIN `User` AS `author` ON `author`.`id` = `reply`.`authorId`
SET
  `reply`.`authorName` = `author`.`name`,
  `reply`.`authorAvatar` = NULLIF(TRIM(`author`.`avatar`), ''),
  `reply`.`authorIdentity` = `author`.`identityType`;

UPDATE `forum_replies` AS `reply`
JOIN `forum_replies` AS `parent` ON `parent`.`id` = `reply`.`parentReplyId`
SET
  `reply`.`replyToUserId` = `parent`.`authorId`,
  `reply`.`replyToAuthorName` = `parent`.`authorName`;

UPDATE `mall_items` AS `item`
JOIN `User` AS `publisher` ON `publisher`.`id` = `item`.`publisherId`
SET
  `item`.`publisherName` = `publisher`.`name`,
  `item`.`publisherAvatar` = NULLIF(TRIM(`publisher`.`avatar`), '');

UPDATE `mall_item_comments` AS `comment`
JOIN `User` AS `author` ON `author`.`id` = `comment`.`userId`
SET
  `comment`.`authorName` = `author`.`name`,
  `comment`.`authorAvatar` = NULLIF(TRIM(`author`.`avatar`), '');

UPDATE `mall_item_comments` AS `comment`
JOIN `mall_item_comments` AS `parent` ON `parent`.`id` = `comment`.`parentId`
SET
  `comment`.`replyToUserId` = `parent`.`userId`,
  `comment`.`replyToAuthorName` = `parent`.`authorName`;

UPDATE `mall_orders` AS `order_row`
JOIN `User` AS `seller` ON `seller`.`id` = `order_row`.`sellerId`
SET
  `order_row`.`sellerName` = `seller`.`name`,
  `order_row`.`sellerAvatar` = NULLIF(TRIM(`seller`.`avatar`), '');

UPDATE `mall_orders` AS `order_row`
JOIN `User` AS `buyer` ON `buyer`.`id` = `order_row`.`buyerId`
SET
  `order_row`.`buyerName` = `buyer`.`name`,
  `order_row`.`buyerAvatar` = NULLIF(TRIM(`buyer`.`avatar`), '');
