const MINI_PROGRAM_DEFAULT_AVATAR = '/static/avatar1.png';

export function validateDefaultAvatarConfiguration(
  appEnv: string | undefined,
  configuredUrl: string | undefined,
): string {
  const value = configuredUrl?.trim() || '';
  if (
    String(appEnv || '')
      .trim()
      .toLowerCase() !== 'production'
  ) {
    return value || MINI_PROGRAM_DEFAULT_AVATAR;
  }
  if (!value) {
    throw new Error('生产环境必须配置 DEFAULT_AVATAR_URL，且必须为 HTTP(S) 绝对 URL');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('生产环境 DEFAULT_AVATAR_URL 必须为 HTTP(S) 绝对 URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('生产环境 DEFAULT_AVATAR_URL 必须为 HTTP(S) 绝对 URL');
  }
  return value;
}

function defaultAvatarUrl(): string {
  return validateDefaultAvatarConfiguration(process.env.APP_ENV, process.env.DEFAULT_AVATAR_URL);
}

export function avatarOrDefault(value: string | null | undefined): string {
  return value?.trim() || defaultAvatarUrl();
}
