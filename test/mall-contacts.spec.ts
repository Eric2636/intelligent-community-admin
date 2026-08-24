import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PublishMallItemDto } from '../src/modules/mall/mall.dto';
import { serializeMallItem } from '../src/modules/mall/mall.serialize';

const now = new Date('2026-08-09T00:00:00.000Z');
const baseItem = {
  id: 'item-1',
  categoryId: 'flea',
  title: '闲置桌子',
  price: '20',
  unit: '元',
  desc: '',
  contact: null,
  locationName: null,
  locationAddress: null,
  latitude: null,
  longitude: null,
  mainImages: null,
  subImages: null,
  videos: null,
  images: null,
  publisherId: 'user-1',
  publisherName: '业主',
  publisherAvatar: null,
  visibility: 'ONLINE',
  pinned: false,
  createdAt: now,
  updatedAt: now,
};

test('商品发布 DTO 接受微信号和大陆手机号，并拒绝错误手机号', async () => {
  const valid = plainToInstance(PublishMallItemDto, {
    categoryId: 'flea',
    title: '闲置桌子',
    wechatContact: 'neighbor_wechat',
    phoneContact: '13800138000',
  });
  const invalidPhone = plainToInstance(PublishMallItemDto, {
    categoryId: 'flea',
    title: '闲置桌子',
    phoneContact: '12345',
  });

  assert.equal((await validate(valid, { whitelist: true, forbidNonWhitelisted: true })).length, 0);
  assert.ok((await validate(invalidPhone, { whitelist: true, forbidNonWhitelisted: true })).length > 0);
});

test('商品序列化按类型返回结构化联系方式，并回退历史单条联系方式', () => {
  const structured = serializeMallItem({
    ...baseItem,
    wechatContact: 'neighbor_wechat',
    phoneContact: '13800138000',
  });
  assert.deepEqual(structured.contacts, [
    { type: 'WECHAT', label: '微信号', value: 'neighbor_wechat' },
    { type: 'PHONE', label: '手机号', value: '13800138000' },
  ]);

  const legacy = serializeMallItem({ ...baseItem, contact: 'old_contact' });
  assert.deepEqual(legacy.contacts, [{ type: 'LEGACY', label: '联系方式', value: 'old_contact' }]);
});

test('手机号也是微信号时只返回一条可添加微信的手机号联系方式', () => {
  const item = serializeMallItem({
    ...baseItem,
    phoneContact: '13800138000',
    phoneIsWechat: true,
  });
  assert.deepEqual(item.contacts, [{ type: 'PHONE_WECHAT', label: '手机号（可添加微信）', value: '13800138000' }]);
});

test('数据库迁移为商品新增结构化联系方式字段', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8');
  const migration = join(root, 'prisma/migrations/20260809000000_add_mall_structured_contacts/migration.sql');

  assert.match(schema, /wechatContact\s+String\?/);
  assert.match(schema, /phoneContact\s+String\?/);
  assert.match(schema, /phoneIsWechat\s+Boolean/);
  assert.equal(existsSync(migration), true);
  assert.match(readFileSync(migration, 'utf8'), /ADD COLUMN `wechatContact`/);
  assert.match(readFileSync(migration, 'utf8'), /ADD COLUMN `phoneContact`/);
});
