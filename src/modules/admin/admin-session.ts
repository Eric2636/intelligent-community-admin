import { HttpError } from '../../http-error';

export class AdminSessionReplacedError extends HttpError {
  constructor() {
    super(401, '账号已在其他设备登录，请重新登录', 'session_replaced');
  }
}

export type AdminSessionRepository = {
  update(args: {
    where: { id: string };
    data: {
      sessionVersion: { increment: number };
      lastLoginAt?: Date;
    };
    select: { id: true; sessionVersion: true };
  }): Promise<{ id: string; sessionVersion: number }>;
};

export async function openAdminSession(repository: AdminSessionRepository, adminId: string) {
  return repository.update({
    where: { id: adminId },
    data: {
      sessionVersion: { increment: 1 },
      lastLoginAt: new Date(),
    },
    select: { id: true, sessionVersion: true },
  });
}

export async function invalidateAdminSession(repository: AdminSessionRepository, adminId: string) {
  return repository.update({
    where: { id: adminId },
    data: { sessionVersion: { increment: 1 } },
    select: { id: true, sessionVersion: true },
  });
}
