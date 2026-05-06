import { HttpError } from '../../http-error';
import { prisma } from '../../lib/prisma';
import {
  cacheAsideJson,
  SETTINGS_MODULE_TABS_KEY,
  SETTINGS_MODULE_TABS_TTL_SEC,
  invalidateModuleEntryTabsCache,
} from '../../lib/redis-cache';

export type ModuleTabKey = 'task' | 'errand' | 'forum' | 'mall' | 'my';

export class SettingsService {
  async getModuleEntryTabs() {
    return cacheAsideJson(SETTINGS_MODULE_TABS_KEY, SETTINGS_MODULE_TABS_TTL_SEC, () =>
      this.loadModuleEntryTabsFromDb(),
    );
  }

  /** 超管：小程序底部模块入口开关（读库，不经过 C 端 Redis 缓存） */
  async listModuleEntryTabsForAdmin() {
    await this.ensureModuleTabsSeeded();
    const rows = await prisma.appSettingTab.findMany({
      orderBy: [{ order: 'asc' }, { key: 'asc' }],
      select: {
        key: true,
        enabled: true,
        always: true,
        label: true,
      },
    });
    return {
      tabs: rows.map((row) => ({
        key: row.key,
        label: row.label || row.key,
        enabled: row.enabled,
        always: row.always,
      })),
    };
  }

  async setModuleTabEnabled(keyRaw: string, enabled: boolean) {
    const key = String(keyRaw || '').trim();
    if (!key) throw new HttpError(400, '缺少模块 key');
    await this.ensureModuleTabsSeeded();
    const row = await prisma.appSettingTab.findUnique({ where: { key } });
    if (!row) throw new HttpError(404, '未知模块');
    if (row.always && !enabled) {
      throw new HttpError(400, '该入口不可关闭');
    }
    await prisma.appSettingTab.update({
      where: { key },
      data: { enabled },
    });
    await invalidateModuleEntryTabsCache();
    return this.listModuleEntryTabsForAdmin();
  }

  private async ensureModuleTabsSeeded() {
    const count = await prisma.appSettingTab.count();
    if (count > 0) return;

    const defaults: Array<{
      key: ModuleTabKey;
      icon: string;
      enabled: boolean;
      always?: boolean;
      labelEnc?: string;
      label?: string;
      order?: number;
    }> = [
      { key: 'task', icon: 'file-copy', enabled: true, label: '业主互助', order: 10 },
      { key: 'errand', icon: 'service', enabled: false, label: '小区跑腿', order: 20 },
      { key: 'forum', icon: 'chat', enabled: true, label: '小区留言', order: 30 },
      { key: 'mall', icon: 'cart', enabled: true, label: '小区市场', order: 40 },
      { key: 'my', icon: 'user', enabled: true, always: true, label: '我的', order: 50 },
    ];

    for (const t of defaults) {
      await prisma.appSettingTab.create({
        data: {
          key: t.key,
          icon: t.icon,
          enabled: t.enabled,
          always: t.always === true,
          labelEnc: t.labelEnc,
          label: t.label,
          order: t.order ?? 0,
        },
      });
    }
  }

  private async loadModuleEntryTabsFromDb() {
    await this.ensureModuleTabsSeeded();
    const rows = await prisma.appSettingTab.findMany({
      orderBy: [{ order: 'asc' }, { key: 'asc' }],
      select: {
        key: true,
        icon: true,
        enabled: true,
        always: true,
        labelEnc: true,
        label: true,
      },
    });

    return { tabs: rows };
  }
}
