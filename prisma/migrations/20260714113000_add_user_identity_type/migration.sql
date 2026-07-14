ALTER TABLE `User` ADD COLUMN `identityType` VARCHAR(32) NULL;

ALTER TABLE `Task` ADD COLUMN `publisherIdentity` VARCHAR(32) NULL;

ALTER TABLE `forum_posts` ADD COLUMN `authorIdentity` VARCHAR(32) NULL;

ALTER TABLE `ForumReply` ADD COLUMN `authorIdentity` VARCHAR(32) NULL;

UPDATE `Task` t
INNER JOIN `User` u ON u.`id` = t.`publisherId`
SET t.`publisherIdentity` = u.`identityType`
WHERE t.`publisherIdentity` IS NULL;

UPDATE `forum_posts` p
INNER JOIN `User` u ON u.`id` = p.`authorId`
SET p.`authorIdentity` = u.`identityType`
WHERE p.`authorIdentity` IS NULL;

UPDATE `ForumReply` r
INNER JOIN `User` u ON u.`id` = r.`authorId`
SET r.`authorIdentity` = u.`identityType`
WHERE r.`authorIdentity` IS NULL;
