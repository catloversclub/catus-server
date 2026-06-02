import { Injectable } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { CopyObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { createPresignedPost } from "@aws-sdk/s3-presigned-post"

export interface PresignedUrlOptions {
  contentType?: string
  expiresInSeconds?: number
  maxSizeBytes?: number
}

export interface PresignedPostResponse {
  url: string
  fields: Record<string, string>
}

@Injectable()
export class StorageService {
  private readonly client: S3Client
  private readonly bucket: string
  private readonly publicBaseUrl: string

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>("S3_BUCKET") ?? "catus-media"
    this.publicBaseUrl = this.resolvePublicBaseUrl()
    this.client = new S3Client({
      region: this.config.get<string>("S3_REGION", "us-east-1"),
      endpoint: this.config.get<string>("S3_ENDPOINT", "http://localhost:9000"),
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.config.get<string>("S3_ACCESS_KEY", "minioadmin"),
        secretAccessKey: this.config.get<string>("S3_SECRET_KEY", "minioadmin"),
      },
    })
  }

  getPublicUrl(value: string | null | undefined): string | null {
    if (value == null) {
      return null
    }

    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }

    const objectKey = this.getObjectKey(trimmed)
    if (objectKey == null) {
      return trimmed
    }

    return this.joinUrl(this.publicBaseUrl, objectKey)
  }

  getObjectKey(value: string | null | undefined): string | null {
    if (value == null) {
      return null
    }

    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }

    const currentPublicKey = this.getObjectKeyFromPublicBaseUrl(trimmed)
    if (currentPublicKey != null) {
      return this.stripBucketPrefix(currentPublicKey)
    }

    try {
      const url = new URL(trimmed)
      return this.getObjectKeyFromUrlPath(url.pathname)
    } catch {
      return this.stripBucketPrefix(trimmed)
    }
  }

  normalizeStorageValue<T extends string | null | undefined>(value: T): T {
    if (value == null) {
      return value
    }

    return (this.getObjectKey(value) ?? value.trim()) as T
  }

  async getPresignedUploadUrl(
    bucket: string,
    objectKey: string,
    options?: PresignedUrlOptions,
  ): Promise<PresignedPostResponse> {
    const expiresIn = options?.expiresInSeconds ?? 60 * 2
    const contentType = options?.contentType
    const maxSizeBytes = options?.maxSizeBytes ?? 10 * 1024 * 1024

    const conditions: any[] = [["content-length-range", 0, maxSizeBytes]]

    if (contentType) {
      conditions.push(["eq", "$Content-Type", contentType])
    }

    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: bucket,
      Key: objectKey,
      Conditions: conditions,
      Fields: contentType ? { "Content-Type": contentType } : {},
      Expires: expiresIn,
    })

    return { url, fields }
  }

  async copyObject(bucket: string, sourceKey: string, destinationKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${sourceKey}`,
        Key: destinationKey,
      }),
    )
  }

  private resolvePublicBaseUrl() {
    const explicitBaseUrl = this.config.get<string>("S3_PUBLIC_BASE_URL")
    if (explicitBaseUrl) {
      return this.trimTrailingSlashes(explicitBaseUrl)
    }

    const publicOrigin =
      this.config.get<string>("MINIO_SERVER_URL") ??
      this.config.get<string>("S3_ENDPOINT", "http://localhost:9000")

    return this.joinUrl(publicOrigin, this.bucket)
  }

  private getObjectKeyFromPublicBaseUrl(value: string) {
    if (value === this.publicBaseUrl) {
      return ""
    }

    const prefix = `${this.publicBaseUrl}/`
    if (!value.startsWith(prefix)) {
      return null
    }

    return value.slice(prefix.length)
  }

  private getObjectKeyFromUrlPath(pathname: string) {
    const normalizedPath = pathname.replace(/^\/+/, "")
    const bucketPrefix = `${this.bucket}/`

    if (normalizedPath === this.bucket) {
      return ""
    }

    if (!normalizedPath.startsWith(bucketPrefix)) {
      return null
    }

    return normalizedPath.slice(bucketPrefix.length)
  }

  private stripBucketPrefix(value: string) {
    const normalized = value.replace(/^\/+/, "")
    const bucketPrefix = `${this.bucket}/`

    if (normalized.startsWith(bucketPrefix)) {
      return normalized.slice(bucketPrefix.length)
    }

    return normalized
  }

  private joinUrl(baseUrl: string, path: string) {
    const normalizedPath = path.replace(/^\/+/, "")
    if (!normalizedPath) {
      return this.trimTrailingSlashes(baseUrl)
    }

    return `${this.trimTrailingSlashes(baseUrl)}/${normalizedPath}`
  }

  private trimTrailingSlashes(value: string) {
    return value.trim().replace(/\/+$/, "")
  }
}
