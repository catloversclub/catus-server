import { IsArray, IsString } from "class-validator"

export class FollowCatsDto {
  @IsArray()
  @IsString({ each: true })
  catIds!: string[]
}
