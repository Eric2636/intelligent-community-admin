import assert from 'node:assert/strict';
import test from 'node:test';
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
