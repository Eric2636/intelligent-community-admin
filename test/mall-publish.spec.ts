import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PublishMallItemDto } from '../src/modules/mall/mall.dto';
import { DEFAULT_MALL_CATEGORIES } from '../src/modules/mall/mall-category.service';
import { MALL_DEFAULT_VISIBILITY } from '../src/modules/mall/mall.constants';

test('mall categories seed the three visible community market sections', () => {
  assert.deepEqual(DEFAULT_MALL_CATEGORIES, [
    { id: 'flea', name: '跳蚤市场', sortOrder: 10, enabled: true },
    { id: 'rental', name: '小区租房', sortOrder: 20, enabled: true },
    { id: 'personal_store', name: '个人店铺', sortOrder: 30, enabled: true },
  ]);
});

test('new mall items publish online without a separate approval step', () => {
  assert.equal(MALL_DEFAULT_VISIBILITY, 'ONLINE');
});

test('mall item description can be omitted or left empty', async () => {
  const base = {
    categoryId: 'flea',
    title: '闲置桌子',
    price: '20',
  };
  const withoutDesc = plainToInstance(PublishMallItemDto, base);
  const emptyDesc = plainToInstance(PublishMallItemDto, { ...base, desc: '' });

  assert.equal((await validate(withoutDesc)).length, 0);
  assert.equal((await validate(emptyDesc)).length, 0);
});
