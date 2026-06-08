import { IsBoolean, IsOptional } from "class-validator"

export class UpdateNotificationSettingsDto {
  @IsOptional()
  @IsBoolean()
  allEnabled?: boolean

  @IsOptional()
  @IsBoolean()
  postLikeEnabled?: boolean

  @IsOptional()
  @IsBoolean()
  commentEnabled?: boolean

  @IsOptional()
  @IsBoolean()
  replyEnabled?: boolean

  @IsOptional()
  @IsBoolean()
  followEnabled?: boolean

  @IsOptional()
  @IsBoolean()
  marketingEnabled?: boolean
}
