import {
  Body,
  Controller,
  Delete,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common"
import { CommentService } from "./comment.service"
import { JwtAuthGuard } from "@app/auth/guards/jwt-auth.guard"
import type { AuthenticatedRequest } from "@app/auth/authenticated-request.interface"
import { CreateCommentDto } from "./dto/create-comment.dto"

@Controller("comment")
@UseGuards(JwtAuthGuard)
export class CommentController {
  constructor(private readonly commentService: CommentService) {}

  @Delete(":id")
  delete(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.commentService.delete(id, req.user.id!)
  }

  @Post(":id/like")
  like(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.commentService.likeComment(id, req.user.id!)
  }

  @Delete(":id/like")
  unlike(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.commentService.unlikeComment(id, req.user.id!)
  }

  @Post(":id/report")
  report(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.commentService.reportComment(id, req.user.id!)
  }
}

@Controller("post/:postId/comment")
@UseGuards(JwtAuthGuard)
export class PostCommentController {
  constructor(private readonly commentService: CommentService) {}

  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Param("postId") postId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.commentService.create(postId, req.user.id!, dto)
  }

  @Get()
  getList(
    @Req() req: AuthenticatedRequest,
    @Param("postId") postId: string,
    @Query("cursor") cursor?: string,
    @Query("take", new DefaultValuePipe(20), ParseIntPipe) take?: number,
  ) {
    return this.commentService.getPostComments(postId, req.user.id!, cursor ?? null, take)
  }
}
