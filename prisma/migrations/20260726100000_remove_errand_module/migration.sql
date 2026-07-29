-- 小区跑腿模块下线。仅删除跑腿专属表；子表先于父表删除以满足外键约束。
DELETE FROM `AppSettingTab` WHERE `key` = 'errand';
DROP TABLE `ErrandFavorite`;
DROP TABLE `ErrandLike`;
DROP TABLE `ErrandReply`;
DROP TABLE `Errand`;
