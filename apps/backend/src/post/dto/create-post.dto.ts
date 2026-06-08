import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString } from "class-validator"

export class CreatePostDto {
  @IsString()
  @IsOptional()
  content?: string | null

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  catIds?: string[] | null

  @IsBoolean()
  @IsOptional()
  isShareable?: boolean | null

  @IsBoolean()
  @IsOptional()
  isCommentable?: boolean | null

  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @IsOptional()
  imageUrls?: string[] | null
}
