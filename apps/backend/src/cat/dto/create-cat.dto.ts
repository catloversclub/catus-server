import { Type } from "class-transformer"
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from "class-validator"

export enum GenderDto {
  MALE = "MALE",
  FEMALE = "FEMALE",
  UNKNOWN = "UNKNOWN",
}

export class CreateCatDto {
  @IsString()
  @IsNotEmpty()
  name!: string

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
