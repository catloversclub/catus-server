import { StorageService } from "./storage.service"

describe("StorageService", () => {
  const buildService = (values: Record<string, string | undefined>) =>
    new StorageService({
      get: jest.fn((key: string, defaultValue?: string) => values[key] ?? defaultValue),
    } as any)

  it("builds public URLs from MINIO_SERVER_URL and bucket", () => {
    const service = buildService({
      MINIO_SERVER_URL: "https://storage.catus.app",
      S3_BUCKET: "catus-media",
    })

    expect(service.getPublicUrl("posts/post-id/images/image.webp")).toBe(
      "https://storage.catus.app/catus-media/posts/post-id/images/image.webp",
    )
  })

  it("rewrites existing full storage URLs to the current public base URL", () => {
    const service = buildService({
      MINIO_SERVER_URL: "https://cdn.catus.app",
      S3_BUCKET: "catus-media",
    })

    expect(
      service.getPublicUrl(
        "https://storage.catus.app/catus-media/users/user-id/profile/image.webp",
      ),
    ).toBe("https://cdn.catus.app/catus-media/users/user-id/profile/image.webp")
  })

  it("normalizes storage values to object keys for database writes", () => {
    const service = buildService({
      MINIO_SERVER_URL: "https://storage.catus.app",
      S3_BUCKET: "catus-media",
    })

    expect(
      service.normalizeStorageValue(
        "https://storage.catus.app/catus-media/tmp/post/user-id/image.webp",
      ),
    ).toBe("tmp/post/user-id/image.webp")
    expect(service.normalizeStorageValue("catus-media/tmp/post/user-id/image.webp")).toBe(
      "tmp/post/user-id/image.webp",
    )
  })

  it("leaves non-storage absolute URLs unchanged", () => {
    const service = buildService({
      MINIO_SERVER_URL: "https://storage.catus.app",
      S3_BUCKET: "catus-media",
    })

    expect(service.getObjectKey("https://example.com/avatar.png")).toBeNull()
    expect(service.getPublicUrl("https://example.com/avatar.png")).toBe(
      "https://example.com/avatar.png",
    )
  })
})
