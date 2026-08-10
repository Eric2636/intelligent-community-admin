import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import COS from 'cos-nodejs-sdk-v5';

type Options = { backup: string; environment: string; confirm: boolean };

function optionsFromArgs(argv: string[]): Options {
  const value = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? String(argv[index + 1] || '').trim() : '';
  };
  const backup = value('--backup');
  const environment = value('--env');
  if (!backup || !environment) throw new Error('必须提供 --backup <清理前数据库备份> 和 --env production');
  return { backup, environment, confirm: argv.includes('--confirm') };
}

function objectKeysFromBackup(text: string, bucket: string, region: string, environment: string) {
  const host = `${bucket}.cos.${region}.myqcloud.com`;
  const pattern = new RegExp(`https:\\/\\/${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/([^'"\\s,\\\\]+)`, 'g');
  const prefix = `${environment}/`;
  const keys = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const key = decodeURIComponent(match[1].replace(/\\\//g, '/'));
    const segments = key.split('/');
    if (
      key.startsWith(prefix) &&
      ['forum', 'task', 'mall', 'avatar'].includes(segments[1] || '') &&
      ['img', 'vid'].includes(segments[2] || '') &&
      !segments.includes('..')
    ) keys.add(key);
  }
  return [...keys].sort();
}

async function deleteBatch(cos: COS, bucket: string, region: string, keys: string[]) {
  return new Promise<{ deleted: number; errors: number }>((resolve, reject) => {
    cos.deleteMultipleObject(
      { Bucket: bucket, Region: region, Objects: keys.map((Key) => ({ Key })), Quiet: true },
      (error, data) => {
        if (error) reject(error);
        else resolve({ deleted: data?.Deleted?.length || 0, errors: data?.Error?.length || 0 });
      },
    );
  });
}

async function main() {
  const options = optionsFromArgs(process.argv.slice(2));
  if (options.environment !== 'production') throw new Error('历史媒体清理仅允许 --env production');
  const bucket = String(process.env.COS_BUCKET || '').trim();
  const region = String(process.env.COS_REGION || '').trim();
  const envPrefix = String(process.env.COS_ENV_PREFIX || '').trim();
  if (!bucket || !region || envPrefix !== 'production') throw new Error('必须使用生产 COS_BUCKET、COS_REGION 与 COS_ENV_PREFIX=production');

  const raw = await readFile(options.backup);
  const text = options.backup.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const keys = objectKeysFromBackup(text, bucket, region, options.environment);
  if (!options.confirm) {
    console.log(JSON.stringify({ mode: 'dry-run', environment: options.environment, matchedObjects: keys.length }, null, 2));
    return;
  }

  const secretId = String(process.env.COS_SECRET_ID || '').trim();
  const secretKey = String(process.env.COS_SECRET_KEY || '').trim();
  if (!secretId || !secretKey) throw new Error('缺少生产 COS 删除凭证');
  const cos = new COS({ SecretId: secretId, SecretKey: secretKey });
  let deleted = 0;
  let errors = 0;
  for (let index = 0; index < keys.length; index += 1000) {
    const result = await deleteBatch(cos, bucket, region, keys.slice(index, index + 1000));
    deleted += result.deleted;
    errors += result.errors;
  }
  console.log(JSON.stringify({ mode: 'confirm', environment: options.environment, matchedObjects: keys.length, deleted, errors }, null, 2));
  if (errors) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[legacy_media_cleanup]', error instanceof Error ? error.message : error);
  process.exit(1);
});
