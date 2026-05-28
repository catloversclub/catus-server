import { JwtAuthGuard } from "@app/auth/guards/jwt-auth.guard"
import type { AuthenticatedRequest } from "@app/auth/authenticated-request.interface"
import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common"
import { SearchService } from "./search.service"
import { SearchQueryDto } from "./dto/search-query.dto"
import { SearchAutocompleteQueryDto } from "./dto/search-autocomplete-query.dto"

@Controller("search")
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get("")
  search(@Req() req: AuthenticatedRequest, @Query() query: SearchQueryDto) {
    return this.searchService.search(req.user.id!, query)
  }

  @Get("autocomplete")
  autocomplete(@Req() req: AuthenticatedRequest, @Query() query: SearchAutocompleteQueryDto) {
    return this.searchService.autocomplete(req.user.id!, query)
  }
}
