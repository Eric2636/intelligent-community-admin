import { IsBoolean } from 'class-validator';

export class UpdateModuleTabEnabledDto {
  @IsBoolean()
  enabled!: boolean;
}
