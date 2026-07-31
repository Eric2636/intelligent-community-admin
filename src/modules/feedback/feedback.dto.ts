import { Transform } from 'class-transformer';
import {
  IsString,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { HttpError } from '../../http-error';

export type NormalizedFeedback = {
  content: string;
};

export type AdminFeedbackIdentity = 'OWNER' | 'OUTSIDER';

export type NormalizedAdminFeedbackQuery = {
  page: number;
  pageSize: number;
  keyword?: string;
  identity?: AdminFeedbackIdentity;
  startAt?: Date;
  endAt?: Date;
};

export function countUnicodeCodePoints(value: string): number {
  return Array.from(value).length;
}

function UnicodeCodePointLength(
  min: number,
  max: number,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'unicodeCodePointLength',
      target: target.constructor,
      propertyName: propertyName.toString(),
      constraints: [min, max],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (typeof value !== 'string') return false;
          const [minimum, maximum] = args.constraints as [number, number];
          const length = countUnicodeCodePoints(value);
          return length >= minimum && length <= maximum;
        },
        defaultMessage(args: ValidationArguments) {
          if (typeof args.value === 'string' && countUnicodeCodePoints(args.value) === 0) {
            return '请输入反馈内容';
          }
          return '反馈内容不能超过500个字符';
        },
      },
    });
  };
}

export function normalizeFeedback(input: { content?: unknown }): NormalizedFeedback {
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  if (!content) throw new HttpError(400, '请输入反馈内容');
  if (countUnicodeCodePoints(content) > 500) {
    throw new HttpError(400, '反馈内容不能超过500个字符');
  }
  return { content };
}

function positiveInteger(value: unknown, fallback: number, label: string, maximum: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new HttpError(400, `${label}格式不正确`);
  }
  if (parsed > maximum) {
    throw new HttpError(400, `${label}不能超过${maximum}`);
  }
  return parsed;
}

function optionalDate(value: unknown, label: string): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.valueOf())) throw new HttpError(400, `${label}格式不正确`);
  return date;
}

export function normalizeAdminFeedbackQuery(
  input: Record<string, unknown>,
): NormalizedAdminFeedbackQuery {
  const keyword = typeof input.keyword === 'string' ? input.keyword.trim() : '';
  const identityRaw = typeof input.identity === 'string' ? input.identity.trim().toUpperCase() : '';
  if (identityRaw && identityRaw !== 'OWNER' && identityRaw !== 'OUTSIDER') {
    throw new HttpError(400, '用户身份格式不正确');
  }
  const startAt = optionalDate(input.startAt, '开始时间');
  const endAt = optionalDate(input.endAt, '结束时间');
  if (startAt && endAt && startAt > endAt) {
    throw new HttpError(400, '提交时间范围不正确');
  }
  return {
    page: positiveInteger(input.page, 1, '页码', 20001),
    pageSize: positiveInteger(input.pageSize, 20, '每页条数', 100),
    ...(keyword ? { keyword } : {}),
    ...(identityRaw ? { identity: identityRaw as AdminFeedbackIdentity } : {}),
    ...(startAt ? { startAt } : {}),
    ...(endAt ? { endAt } : {}),
  };
}

export class CreateFeedbackDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: '反馈内容格式不正确' })
  @UnicodeCodePointLength(1, 500)
  content!: string;
}
