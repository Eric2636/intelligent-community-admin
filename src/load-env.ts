import { existsSync } from 'fs';
import { resolve } from 'path';
import { config as loadDotenv } from 'dotenv';

const root = resolve(__dirname, '..');

export type AppEnvProfile = 'development' | 'local';

function resolveProfile(): AppEnvProfile {
  const raw = process.env.APP_ENV?.trim().toLowerCase();
  return raw === 'local' ? 'local' : 'development';
}

const profile = resolveProfile();

const baseFileByProfile: Record<AppEnvProfile, string> = {
  development: '.env.development',
  local: '.env.local',
};

const basePath = resolve(root, baseFileByProfile[profile]);
const envPath = resolve(root, '.env');

/** 先按 APP_ENV 加载对应基础文件，再用根目录 .env 覆盖（密钥与个人覆盖放 .env） */
if (existsSync(basePath)) {
  loadDotenv({ path: basePath, override: false });
}
if (existsSync(envPath)) {
  loadDotenv({ path: envPath, override: true });
}
