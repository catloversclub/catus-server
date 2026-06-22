import {
  Controller,
  DefaultValuePipe,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  ParseIntPipe,
  Query,
} from "@nestjs/common"
import { PostService } from "./post.service"
import { CreatePostDto } from "./dto/create-post.dto"
import { UpdatePostDto } from "./dto/update-post.dto"
import { JwtAuthGuard } from "@app/auth/guards/jwt-auth.guard"
import type { AuthenticatedRequest } from "@app/auth/authenticated-request.interface"
import { PostImageUploadUrlDto } from "./dto/post-image-upload-url.dto"

@Controller("post")
@UseGuards(JwtAuthGuard)
export class PostController {
  constructor(private readonly postService: PostService) {}

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() createPostDto: CreatePostDto) {
    return this.postService.create(req.user.id!, createPostDto)
  }

  @Post("image/upload-url")
  getImageUploadUrl(@Req() req: AuthenticatedRequest, @Body() body: PostImageUploadUrlDto) {
    return this.postService.getImageUploadUrls(req.user.id!, body.count)
  }

  @Get("my")
  getMyPosts(
    @Req() req: AuthenticatedRequest,
    @Query("cursor") cursor?: string,
    @Query("take", new DefaultValuePipe(20), ParseIntPipe) take?: number,
  ) {
    return this.postService.getMyPosts(req.user.id!, cursor ?? null, take)
  }

  @Get("bookmark/my")
  getMyBookmarkedPosts(
    @Req() req: AuthenticatedRequest,
    @Query("cursor") cursor?: string,
    @Query("take", new DefaultValuePipe(20), ParseIntPipe) take?: number,
  ) {
    return this.postService.getMyBookmarkedPosts(req.user.id!, cursor ?? null, take)
  }

  @Get("liked/my")
  getMyLikedPosts(
    @Req() req: AuthenticatedRequest,
    @Query("cursor") cursor?: string,
    @Query("take", new DefaultValuePipe(20), ParseIntPipe) take?: number,
  ) {
    return this.postService.getMyLikedPosts(req.user.id!, cursor ?? null, take)
  }

  @Get("feed")
  getFeed(
    @Req() req: AuthenticatedRequest,
    @Query("cursor") cursor?: string,
    @Query("take", new DefaultValuePipe(20), ParseIntPipe) take?: number,
    @Query("type") type: "following" | "recommended" = "following",
  ) {
    if (type === "recommended") {
      return this.postService.getRecommendedFeed(req.user.id!, cursor ?? null, take)
    }

    return this.postService.getFollowingFeed(req.user.id!, cursor ?? null, take)
  }

  @Get("feed/daily-popular")
  getDailyPopularFeed(
    @Req() req: AuthenticatedRequest,
    @Query("take", new DefaultValuePipe(10), ParseIntPipe) take?: number,
  ) {
    return this.postService.getDailyPopularFeed(req.user.id!, take)
  }

  @Get(":id")
  findOne(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.postService.findOne(id, req.user.id!)
  }

  @Patch(":id")
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() updatePostDto: UpdatePostDto,
  ) {
    return this.postService.update(id, req.user.id!, updatePostDto)
  }

  @Delete(":id")
  delete(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.postService.delete(id, req.user.id!)
  }

  @Post(":id/like")
  likePost(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.postService.likePost(id, req.user.id!)
  }

  @Delete(":id/like")
  unlikePost(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.postService.unlikePost(id, req.user.id!)
  }

  @Get(":id/likes")
  getPostLikedUsers(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Query("cursor") cursor?: string,
    @Query("take", new DefaultValuePipe(20), ParseIntPipe) take?: number,
  ) {
    return this.postService.getPostLikedUsers(id, req.user.id!, cursor ?? null, take)
  }

  @Post(":id/bookmark")
  bookmarkPost(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.postService.bookmarkPost(id, req.user.id!)
  }

  @Delete(":id/bookmark")
  unbookmarkPost(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.postService.unbookmarkPost(id, req.user.id!)
  }

  @Post(":id/report")
  reportPost(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.postService.reportPost(id, req.user.id!)
  }
}

@Controller("user")
@UseGuards(JwtAuthGuard)
export class UserPostController {
  constructor(private readonly postService: PostService) {}

  @Get(":id/post")
  getUserPosts(
    @Req() req: AuthenticatedRequest,
    @Param("id") userId: string,
    @Query("cursor") cursor?: string,
    @Query("take", new DefaultValuePipe(20), ParseIntPipe) take?: number,
  ) {
    return this.postService.getUserPosts(userId, req.user.id!, cursor ?? null, take)
  }
}

@Controller("cat")
@UseGuards(JwtAuthGuard)
export class CatPostController {
  constructor(private readonly postService: PostService) {}

  @Get(":id/post")
  getCatPosts(
    @Req() req: AuthenticatedRequest,
    @Param("id") catId: string,
    @Query("cursor") cursor?: string,
    @Query("take", new DefaultValuePipe(20), ParseIntPipe) take?: number,
  ) {
    return this.postService.getCatPosts(catId, req.user.id!, cursor ?? null, take)
  }
}
