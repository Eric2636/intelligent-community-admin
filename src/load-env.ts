import { existsSync } from 'fs';
import { resolve } from 'path';
import { config as loadDotenv } from 'dotenv';

const root = resolve(__dirname, '..');

const devPath = resolve(root, '.env.development');
const envPath = resolve(root, '.env');

/** 先加载团队/示例默认值，再用根目录 .env 覆盖（避免 override:false 导致 .env 里的 JWT_SECRET 等永远不生效） */
if (existsSync(devPath)) {
  loadDotenv({ path: devPath, override: false });
}
if (existsSync(envPath)) {
  loadDotenv({ path: envPath, override: true });
}
