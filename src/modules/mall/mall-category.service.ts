import { HttpError } from '../../http-error';
import { prisma } from '../../lib/prisma';

export type MallCategoryRow = {
  id: string;
  name: string;
  sortOrder: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type MallCategoryView = {
  id: string;
  name: string;
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_MALL_CATEGORIES: Array<{ id: string; name: string; sortOrder: number; enabled: boolean }> = [
  { id: 'flea', name: '跳蚤市场', sortOrder: 10, enabled: true },
  { id: 'rental', name: '小区租房', sortOrder: 20, enabled: true },
  { id: 'personal_store', name: '个人店铺', sortOrder: 30, enabled: true },
];

function serializeCategory(row: MallCategoryRow): MallCategoryView {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    enabled: Boolean(row.enabled),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function makeCategoryId() {
  return `cat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class MallCategoryService {
  async ensureDefaultCategories() {
    const countRows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM mall_categories`;
    if (Number(countRows[0]?.count || 0) > 0) return;
    for (const category of DEFAULT_MALL_CATEGORIES) {
      await prisma.$executeRaw`
        INSERT INTO mall_categories (id, name, sortOrder, enabled)
        VALUES (${category.id}, ${category.name}, ${category.sortOrder}, ${category.enabled})
        ON DUPLICATE KEY UPDATE name = VALUES(name), sortOrder = VALUES(sortOrder), enabled = VALUES(enabled)
      `;
    }
  }

  async listCategories(options: { includeDisabled?: boolean } = {}) {
    await this.ensureDefaultCategories();
    const rows = options.includeDisabled
      ? await prisma.$queryRaw<MallCategoryRow[]>`
          SELECT id, name, sortOrder, enabled, createdAt, updatedAt
          FROM mall_categories
          ORDER BY sortOrder ASC, createdAt ASC
        `
      : await prisma.$queryRaw<MallCategoryRow[]>`
          SELECT id, name, sortOrder, enabled, createdAt, updatedAt
          FROM mall_categories
          WHERE enabled = true
          ORDER BY sortOrder ASC, createdAt ASC
        `;
    return rows.map(serializeCategory);
  }

  async assertEnabledCategoryId(categoryIdRaw: string) {
    const categoryId = categoryIdRaw.trim();
    if (!categoryId) throw new HttpError(400, 'categoryId 不能为空');
    await this.ensureDefaultCategories();
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM mall_categories WHERE id = ${categoryId} AND enabled = true LIMIT 1
    `;
    if (!rows.length) throw new HttpError(400, '分类不存在或已停用');
    return categoryId;
  }

  async createCategory(params: { name: string; sortOrder?: number; enabled?: boolean }) {
    const name = params.name.trim();
    if (!name) throw new HttpError(400, '分类名称不能为空');
    const id = makeCategoryId();
    const sortOrder = Number.isFinite(params.sortOrder) ? Number(params.sortOrder) : 0;
    const enabled = params.enabled !== false;
    await prisma.$executeRaw`
      INSERT INTO mall_categories (id, name, sortOrder, enabled)
      VALUES (${id}, ${name}, ${sortOrder}, ${enabled})
    `;
    return this.getCategory(id);
  }

  async updateCategory(idRaw: string, params: { name?: string; sortOrder?: number; enabled?: boolean }) {
    const id = idRaw.trim();
    if (!id) throw new HttpError(400, '分类 id 不能为空');
    const current = await this.getCategory(id);
    const name = params.name === undefined ? current.name : params.name.trim();
    if (!name) throw new HttpError(400, '分类名称不能为空');
    const sortOrder = params.sortOrder === undefined ? current.sortOrder : Number(params.sortOrder);
    const enabled = params.enabled === undefined ? current.enabled : Boolean(params.enabled);
    await prisma.$executeRaw`
      UPDATE mall_categories
      SET name = ${name}, sortOrder = ${sortOrder}, enabled = ${enabled}
      WHERE id = ${id}
    `;
    return this.getCategory(id);
  }

  async deleteCategory(idRaw: string) {
    const id = idRaw.trim();
    if (!id) throw new HttpError(400, '分类 id 不能为空');
    await this.getCategory(id);
    const usedRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM MallItem WHERE categoryId = ${id}
    `;
    if (Number(usedRows[0]?.count || 0) > 0) {
      throw new HttpError(400, '该分类已有商品使用，不能删除，请改为停用');
    }
    await prisma.$executeRaw`DELETE FROM mall_categories WHERE id = ${id}`;
    return { id };
  }

  async getCategory(idRaw: string) {
    const id = idRaw.trim();
    const rows = await prisma.$queryRaw<MallCategoryRow[]>`
      SELECT id, name, sortOrder, enabled, createdAt, updatedAt
      FROM mall_categories
      WHERE id = ${id}
      LIMIT 1
    `;
    if (!rows.length) throw new HttpError(404, '分类不存在');
    return serializeCategory(rows[0]);
  }
}
