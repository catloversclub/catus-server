import { Module } from "@nestjs/common"
import { PrismaModule } from "@app/prisma/prisma.module"
import { StorageModule } from "@app/storage/storage.module"
import { ShareController } from "./share.controller"
import { ShareService } from "./share.service"

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [ShareController],
  providers: [ShareService],
})
export class ShareModule {}
