function removeDangerousMarkupBlocks(content: string): string {
  const dangerousTag = /<\s*(\/?)\s*(script|style)\b[^>]*>/gi;
  const openTags: string[] = [];
  let safeText = '';
  let safeTextCursor = 0;
  let match: RegExpExecArray | null;

  while ((match = dangerousTag.exec(content)) !== null) {
    const isClosingTag = Boolean(match[1]);
    const tagName = match[2]?.toLowerCase() ?? '';
    if (openTags.length === 0) {
      if (isClosingTag) continue;
      safeText += content.slice(safeTextCursor, match.index);
      safeTextCursor = dangerousTag.lastIndex;
      openTags.push(tagName);
      continue;
    }
    if (!isClosingTag) {
      openTags.push(tagName);
      continue;
    }
    const matchingOpenTag = openTags.lastIndexOf(tagName);
    if (matchingOpenTag === -1) continue;
    openTags.splice(matchingOpenTag, 1);
    if (openTags.length === 0) safeTextCursor = dangerousTag.lastIndex;
  }

  if (openTags.length === 0) safeText += content.slice(safeTextCursor);
  return safeText;
}

function normalizePlainText(content: string): string {
  const withoutMarkup = removeDangerousMarkupBlocks(String(content || '')).replace(
    /<[^>]*>/g,
    '',
  );
  const withoutControls = Array.from(withoutMarkup)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        codePoint === 9 ||
        codePoint === 10 ||
        codePoint === 13 ||
        (codePoint > 31 && (codePoint < 127 || codePoint > 159))
      );
    })
    .join('');
  return withoutControls.replace(/\s+/g, ' ').trim();
}

export function sanitizeNotificationText(
  content: string,
  maxCodePoints = 80,
  fallback = '',
): string {
  const normalized = normalizePlainText(content);
  const safeFallback = normalizePlainText(fallback);
  return Array.from(normalized || safeFallback)
    .slice(0, Math.max(0, maxCodePoints))
    .join('');
}
