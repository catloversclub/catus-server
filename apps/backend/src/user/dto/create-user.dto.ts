import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from "class-validator"
import { Type } from "class-transformer"

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  nickname!: string

  @IsBoolean()
  @IsOptional()
  isLivingWithCat?: boolean

  @IsBoolean()
  @IsOptional()
  hasAgreedToTerms?: boolean

  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  @IsOptional()
  @ArrayMaxSize(2)
  favoritePersonalities?: number[]

  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  @IsOptional()
  @ArrayMaxSize(2)
  favoriteAppearances?: number[]

  @IsString()
  @IsOptional()
  phone?: string | null

  @IsString()
  @IsOptional()
  profileImageUrl?: string | null
}
