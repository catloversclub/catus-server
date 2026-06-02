import { ArrayMaxSize, IsArray, IsOptional, IsString } from "class-validator"

export class CreatePostDto {
  @IsString()
  @IsOptional()
  content?: string | null

  @IsString()
  @IsOptional()
  catId?: string | null

  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @IsOptional()
  imageUrls?: string[] | null
}
