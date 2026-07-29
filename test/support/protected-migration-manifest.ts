export const protectedMigrationHashes = new Map<string, string>([
  [
    '20260509154000_add_forum_announcements',
    '82e720cc45b82112afa7bbc7480b0e530fd3cefa9aafda16bae1046dc99d8c42',
  ],
  [
    '20260525120000_add_mall_item_location',
    '504bc6cec964a1787fa7f541cb96cd12377a9135ac97409591e95a1a97891b54',
  ],
  [
    '20260607103000_add_forum_post_share_count',
    '69f177a08057003f3228d193850f624fb2c1d2da7a612c6b50a1fec184b50972',
  ],
  [
    '20260709170000_add_mall_categories',
    '9cc3b6580d789fcad2a3c65370758f0a07f3a81c40cce16cd67c15f15135f4c4',
  ],
  [
    '20260714113000_add_user_identity_type',
    '5b413c03dd0e0ead50b3830f733b16fe1eb24ec50f14f3928ae923f94165ec85',
  ],
  [
    '20260714162000_add_user_household_no',
    'f4dae004bb74b68a1b15941abaf2f44fab8901d3473d3738d4486fa27fab3839',
  ],
  [
    '20260726090000_add_author_avatar_snapshots',
    '78334ab65f032f79e88da30b1374eb0d56534376d8a2b8324d61d803cfb06a1a',
  ],
  [
    '20260726100000_remove_errand_module',
    '58b674939cdfebf0508b3e848df43e11ca5cdd799e75f3f5a23a39025c5692dd',
  ],
  [
    '20260726120000_simplify_feedback',
    'f8c6aa2c107b90e8eec6fd69d2bd5cd49e74ae81f1cb7146f43621a10e362ff4',
  ],
  [
    '20260726130000_add_notification_center',
    'da8806ee5757c1c02afb784a301083f4dd9263442ce0ee7e3f07e1dccbde001a',
  ],
]);

export function assertProtectedMigrationManifest(
  protectedHashes: ReadonlyMap<string, string>,
  actualHashes: ReadonlyMap<string, string>,
) {
  for (const [migrationName, expectedHash] of protectedHashes) {
    const actualHash = actualHashes.get(migrationName);
    if (actualHash === undefined) {
      throw new Error(`protected migration is missing: ${migrationName}`);
    }
    if (actualHash !== expectedHash) {
      throw new Error(`protected migration was modified: ${migrationName}`);
    }
  }
}
