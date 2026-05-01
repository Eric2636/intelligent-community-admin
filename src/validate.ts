import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { HttpError } from './http-error';

function formatValidationErrors(errors: ValidationError[]): string {
  const msgs = errors.flatMap((e) => {
    if (e.constraints) return Object.values(e.constraints);
    if (e.children?.length) return [formatValidationErrors(e.children)];
    return [];
  });
  return msgs.flat().join('; ') || '参数校验失败';
}

export async function parseDto<T extends object>(
  Cls: ClassConstructor<T>,
  plain: unknown,
): Promise<T> {
  const instance = plainToInstance(Cls, plain ?? {}, {
    enableImplicitConversion: true,
  });
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length) {
    throw new HttpError(400, formatValidationErrors(errors));
  }
  return instance;
}
