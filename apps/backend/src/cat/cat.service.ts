import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common"
import { getImageExtension } from "@app/storage/image-types.const"
import { ConfigService } from "@nestjs/config"
import { CreateCatDto } from "./dto/create-cat.dto"
import { UpdateCatDto } from "./dto/update-cat.dto"
import { PrismaService } from "@app/prisma/prisma.service"
import { StorageService } from "@app/storage/storage.service"
import { getVisibleUserWhere } from "@app/common/user-block-visibility"
import { uuidv7 } from "uuidv7"

@Injectable()
export class CatService {
  private readonly bucket: string
  private readonly catProfileInclude = {
    appearances: {
      select: {
        id: true,
      },
    },
    personalities: {
      select: {
        id: true,
      },
    },
  } as const

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {
    this.bucket = this.config.get<string>("S3_BUCKET") ?? "catus-media"
  }

  private formatCatProfile<
    T extends {
      appearances: Array<{ id: number }>
      personalities: Array<{ id: number }>
    },
  >(cat: T) {
    const { appearances, personalities, ...rest } = cat

    return {
      ...rest,
      appearances: appearances.map(({ id }) => id),
      personalities: personalities.map(({ id }) => id),
    }
  }

  private formatCatProfileList<
    T extends {
      appearances: Array<{ id: number }>
      personalities: Array<{ id: number }>
    },
  >(cats: T[]) {
    return cats.map((cat) => this.formatCatProfile(cat))
  }

  async create(userId: string, createCatDto: CreateCatDto) {
    const { appearances, personalities, ...rest } = createCatDto

    const cat = await this.prisma.cat.create({
      data: {
        ...rest,
        appearances: appearances?.length
          ? { connect: appearances.map((id) => ({ id })) }
          : undefined,
        personalities: personalities?.length
          ? { connect: personalities.map((id) => ({ id })) }
          : undefined,
        butlerId: userId,
      },
      include: this.catProfileInclude,
    })

    return this.formatCatProfile(cat)
  }

  async getMyCats(userId: string) {
    const cats = await this.prisma.cat.findMany({
      where: { butlerId: userId },
      include: this.catProfileInclude,
    })

    return this.formatCatProfileList(cats)
  }

  async getUserCats(userId: string, viewerId: string) {
    await this.prisma.user.findFirstOrThrow({
      where: {
        id: userId,
        ...getVisibleUserWhere(viewerId),
      },
      select: { id: true },
    })

    const cats = await this.prisma.cat.findMany({
      where: {
        butlerId: userId,
        butler: getVisibleUserWhere(viewerId),
      },
      orderBy: { id: "desc" },
      include: this.catProfileInclude,
    })

    return this.formatCatProfileList(cats)
  }

  async findOne(id: string, viewerId: string) {
    const cat = await this.prisma.cat.findFirstOrThrow({
      where: {
        id,
        butler: getVisibleUserWhere(viewerId),
      },
      include: this.catProfileInclude,
    })

    return this.formatCatProfile(cat)
  }

  async update(id: string, userId: string, updateCatDto: UpdateCatDto) {
    await this.isMyCat(id, userId)

    const { appearances, personalities, ...rest } = updateCatDto

    const cat = await this.prisma.cat.update({
      where: { id },
      data: {
        ...rest,
        ...(appearances !== undefined && {
          appearances: {
            set: appearances.map((appearanceId) => ({ id: appearanceId })),
          },
        }),
        ...(personalities !== undefined && {
          personalities: {
            set: personalities.map((personalityId) => ({ id: personalityId })),
          },
        }),
      },
      include: this.catProfileInclude,
    })

    return this.formatCatProfile(cat)
  }

  async delete(id: string, userId: string) {
    await this.isMyCat(id, userId)
    return this.prisma.cat.delete({ where: { id } })
  }

  private async isMyCat(catId: string, userId: string) {
    const cat = await this.prisma.cat.findUnique({
      where: { id: catId },
      select: { butlerId: true },
    })

    if (cat?.butlerId !== userId) {
      throw new ForbiddenException("She's not your cat")
    }
  }

  async getProfileImageUploadUrl(catId: string, userId: string, contentType?: string) {
    await this.isMyCat(catId, userId)
    if (!contentType) {
      throw new BadRequestException("contentType is required")
    }
    const ext = getImageExtension(contentType)
    if (!ext) {
      throw new BadRequestException("Only image content types are allowed: jpeg, png, webp, avif")
    }
    const unique = uuidv7()
    const objectKey = `cats/${catId}/profile/${unique}.${ext}`

    const { url, fields } = await this.storage.getPresignedUploadUrl(this.bucket, objectKey, {
      contentType,
      expiresInSeconds: 60 * 2,
      maxSizeBytes: 5 * 1024 * 1024,
    })

    return { url, fields, key: objectKey }
  }
}
