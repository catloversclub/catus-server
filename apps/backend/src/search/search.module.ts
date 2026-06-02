import { Module } from "@nestjs/common"
import { PrismaModule } from "@app/prisma/prisma.module"
import { AuthModule } from "@app/auth/auth.module"
import { SearchController } from "./search.controller"
import { SearchService } from "./search.service"
import { StorageModule } from "@app/storage/storage.module"

@Module({
  imports: [PrismaModule, AuthModule, StorageModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
