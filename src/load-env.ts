import { existsSync } from 'fs';
import { resolve } from 'path';
import { config as loadDotenv } from 'dotenv';

const root = resolve(__dirname, '..');

export type AppEnvProfile = 'development' | 'local' | 'test' | 'production';

export function normalizeAppEnv(value?: string): AppEnvProfile {
  const raw = value?.trim().toLowerCase();
  if (raw === 'local' || raw === 'test' || raw === 'production') return raw;
  return 'development';
}

const baseFileByProfile: Record<AppEnvProfile, string> = {
  development: '.env.development',
  local: '.env.local',
  test: '.env.test',
  production: '.env.production',
};

export function baseEnvFileForAppEnv(profile: AppEnvProfile) {
  return baseFileByProfile[profile];
}

const profile = normalizeAppEnv(process.env.APP_ENV);
process.env.APP_ENV = profile;

const basePath = resolve(root, baseEnvFileForAppEnv(profile));
const envPath = resolve(root, '.env');

/** 先按 APP_ENV 加载对应基础文件，再用根目录 .env 覆盖（密钥与个人覆盖放 .env） */
if (existsSync(basePath)) {
  loadDotenv({ path: basePath, override: false });
}
if (existsSync(envPath)) {
  loadDotenv({ path: envPath, override: true });
}
