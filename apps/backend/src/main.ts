import { NestFactory } from "@nestjs/core"
import { AppModule } from "./app.module"
import { ValidationPipe } from "@nestjs/common"
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { NextFunction, Request, Response } from "express"

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const s3 = new S3Client({
    region: "us-east-1",
    endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
    forcePathStyle: true,
  })

  const bucketName = process.env.S3_BUCKET || "catus-media"

  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }))
  } catch (err: any) {
    if (err.$metadata?.httpStatusCode === 404) {
      await s3.send(new CreateBucketCommand({ Bucket: bucketName }))
      console.log(`✅ Created bucket: ${bucketName}`)

      const publicPolicy = {
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "PublicReadGetObject",
            Effect: "Allow",
            Principal: "*",
            Action: ["s3:GetObject"],
            Resource: [`arn:aws:s3:::${bucketName}/*`],
          },
        ],
      }

      await s3.send(
        new PutBucketPolicyCommand({
          Bucket: bucketName,
          Policy: JSON.stringify(publicPolicy),
        }),
      )

      console.log(`🌍 Bucket '${bucketName}' is now public-read`)
    } else {
      console.error("❌ Failed to check bucket:", err)
    }
  }
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Instance-Id", process.env.HOSTNAME || "unknown")
    next()
  })

  app.enableCors({
    origin: ["http://localhost:3000", "https://catus.app"],
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })

  await app.listen(process.env.PORT ?? 3000)
}
bootstrap()
