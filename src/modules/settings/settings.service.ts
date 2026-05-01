import { prisma } from '../../lib/prisma';
import {
  cacheAsideJson,
  SETTINGS_MODULE_TABS_KEY,
  SETTINGS_MODULE_TABS_TTL_SEC,
} from '../../lib/redis-cache';

type ModuleTabKey = 'task' | 'errand' | 'forum' | 'mall' | 'my';

/** 为 false 时小程序不展示「小区跑腿」Tab 与相关入口；上线该模块时改为 true */
const ERRAND_MODULE_ENABLED = false;

export class SettingsService {
  async getModuleEntryTabs() {
    return cacheAsideJson(SETTINGS_MODULE_TABS_KEY, SETTINGS_MODULE_TABS_TTL_SEC, () =>
      this.loadModuleEntryTabsFromDb(),
    );
  }

  private async loadModuleEntryTabsFromDb() {
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
      { key: 'errand', icon: 'service', enabled: ERRAND_MODULE_ENABLED, label: '小区跑腿', order: 20 },
      { key: 'forum', icon: 'chat', enabled: true, label: '小区留言', order: 30 },
      { key: 'mall', icon: 'cart', enabled: true, label: '小区市场', order: 40 },
      { key: 'my', icon: 'user', enabled: true, always: true, label: '我的', order: 50 },
    ];

    const count = await prisma.appSettingTab.count();
    if (count === 0) {
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

    const tabs = rows.map((row) =>
      row.key === 'errand' ? { ...row, enabled: ERRAND_MODULE_ENABLED } : row,
    );

    return { tabs };
  }
}

