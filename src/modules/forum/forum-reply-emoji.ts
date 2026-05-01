/** 评论表情白名单（与小程序展示一致） */
export const FORUM_REPLY_EMOJI_WHITELIST = ['❤️', '😂', '😭', '👍', '🔥', '🙏', '😍', '👏'] as const;

export type ForumReplyEmoji = (typeof FORUM_REPLY_EMOJI_WHITELIST)[number];

export function isAllowedReplyEmoji(s: string): s is ForumReplyEmoji {
  return (FORUM_REPLY_EMOJI_WHITELIST as readonly string[]).includes(s);
}
