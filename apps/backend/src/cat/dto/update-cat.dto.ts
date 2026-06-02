import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
} from "class-validator"
import { GenderDto } from "./create-cat.dto"
import { Type } from "class-transformer"

export class UpdateCatDto {
  @IsString()
  @IsOptional()
  name?: string

  @IsEnum(GenderDto)
  @IsOptional()
  gender?: GenderDto

  @IsString()
  @IsOptional()
  profileImageUrl?: string | null

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  birthDate?: Date | null

  @IsString()
  @IsOptional()
  breed?: string | null

  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  @IsOptional()
  @ArrayMaxSize(2)
  personalities?: number[]

  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  @IsOptional()
  @ArrayMaxSize(2)
  appearances?: number[]
}
