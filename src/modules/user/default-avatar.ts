const LEGACY_DEFAULT_AVATAR = '/static/avatar1.png';

export function validateDefaultAvatarConfiguration(
  _appEnv: string | undefined,
  _configuredUrl: string | undefined,
): string {
  // 默认头像由小程序的 TDesign `user` 矢量图负责渲染，服务端不再要求图片 URL。
  return '';
}

export function avatarOrDefault(value: string | null | undefined): string {
  const avatar = value?.trim() || '';
  const legacyConfiguredDefault = process.env.DEFAULT_AVATAR_URL?.trim() || '';
  // 已发布内容可能仍存有旧默认头像；统一归为空值，交给客户端显示 TDesign 图标。
  if (!avatar || avatar === LEGACY_DEFAULT_AVATAR || (legacyConfiguredDefault && avatar === legacyConfiguredDefault)) return '';
  return avatar;
}
