import { IsString, MinLength, Matches } from 'class-validator';

export class CreateAccountDto {
  @IsString()
  @MinLength(1)
  platform!: string;

  // IG handle 允许字母数字点下划线
  @IsString()
  @MinLength(1)
  @Matches(/^[A-Za-z0-9._]+$/, { message: 'invalid handle' })
  handle!: string;
}
