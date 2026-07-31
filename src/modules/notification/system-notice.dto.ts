import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { sanitizeNotificationText } from './notification-text';

function UnicodeLength(maximum: number, validationOptions?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'unicodeLength',
      target: target.constructor,
      propertyName: propertyName.toString(),
      constraints: [maximum],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [max] = args.constraints as [number];
          return typeof value === 'string' && Array.from(value).length <= max;
        },
      },
    });
  };
}

function Utf8ByteLength(maximum: number, validationOptions?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'utf8ByteLength',
      target: target.constructor,
      propertyName: propertyName.toString(),
      constraints: [maximum],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [max] = args.constraints as [number];
          return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= max;
        },
      },
    });
  };
}

function toSafePlainText(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return sanitizeNotificationText(value, Number.MAX_SAFE_INTEGER);
}

export class CreateSystemNoticeDto {
  @Transform(({ value }) => toSafePlainText(value))
  @IsString({ message: '通知标题格式不正确' })
  @IsNotEmpty({ message: '通知标题不能为空或缺少有效文本' })
  @UnicodeLength(191, { message: '通知标题不能超过191个字符' })
  title!: string;

  @Transform(({ value }) => toSafePlainText(value))
  @IsString({ message: '通知内容格式不正确' })
  @IsNotEmpty({ message: '通知内容不能为空或缺少有效文本' })
  @Utf8ByteLength(65_535, { message: '通知内容不能超过65535字节' })
  content!: string;

  @IsString({ message: '请求标识格式不正确' })
  @Length(16, 64, { message: '请求标识 clientRequestId 长度必须为16到64个字符' })
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: '请求标识 clientRequestId 只能包含字母、数字、下划线和短横线',
  })
  clientRequestId!: string;
}
