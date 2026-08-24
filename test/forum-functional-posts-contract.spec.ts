import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const forumService = readFileSync(new URL('../src/modules/forum/forum.service.ts', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/routes/index.ts', import.meta.url), 'utf8');
const adminRoutes = readFileSync(new URL('../src/routes/admin.routes.ts', import.meta.url), 'utf8');
const uploadService = readFileSync(new URL('../src/modules/upload/upload.service.ts', import.meta.url), 'utf8');

test('forum posts separate display channel from feature type', () => {
  assert.match(schema, /enum ForumPostFeatureType\s*\{[\s\S]*CONTENT[\s\S]*REGISTRATION/);
  assert.match(schema, /featureType\s+ForumPostFeatureType\s+@default\(CONTENT\)/);
  assert.match(schema, /model ForumPostRegistration\s*\{/);
  assert.match(schema, /model ForumPostRegistrationEntry\s*\{/);
  assert.match(schema, /@@unique\(\[postId, userId\]\)/);
});

test('mini-program announcements receive a 30-day default expiry when published', () => {
  assert.match(
    forumService,
    /const announcementValidUntil = postType === 'ANNOUNCEMENT'\s*\? new Date\(Date\.now\(\) \+ 30 \* 24 \* 60 \* 60 \* 1000\)\s*:\s*null;/,
  );
  assert.match(forumService, /postType,\s*\n\s*featureType,\s*\n\s*validUntil: announcementValidUntil,/);
});

test('forum attachments have a dedicated file asset relation and strict server constraints', () => {
  const asset = schema.match(/model MediaAsset \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const attachment = schema.match(/model ForumPostAttachment \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(schema, /enum MediaAssetType \{[\s\S]*FILE/);
  assert.match(asset, /^\s*originalName\s+String/m);
  assert.match(asset, /^\s*contentType\s+String/m);
  assert.match(asset, /^\s*sizeBytes\s+Int/m);
  assert.match(attachment, /^\s*postId\s+String/m);
  assert.match(attachment, /^\s*mediaAssetId\s+String\s+@unique/m);
  assert.match(attachment, /@@index\(\[postId, sortOrder\]\)/);
  assert.match(forumService, /MAX_POST_ATTACHMENTS\s*=\s*5/);
  assert.match(forumService, /attachments\?:\s*\{\s*mediaAssetId:\s*string\s*\}\[\]/);
  assert.match(uploadService, /MAX_FORUM_ATTACHMENT_BYTES\s*=\s*20 \* 1024 \* 1024/);
  assert.match(uploadService, /FORUM_ATTACHMENT_EXTENSIONS/);
});

test('forum attachment upload endpoints require the appropriate administrator auth', () => {
  assert.match(routes, /router\.post\('\/api\/posts\/attachments\/upload', jwtAuth/);
  assert.match(routes, /forumService\.assertCanManageAttachments\(userId\)/);
  assert.match(adminRoutes, /router\.post\('\/api\/admin\/posts\/attachments\/upload', adminAuth/);
  assert.match(adminRoutes, /uploadService\.uploadForumAttachment/);
});
