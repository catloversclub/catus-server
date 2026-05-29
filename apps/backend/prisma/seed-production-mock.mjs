import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { loadEnvFile } from "node:process"

loadEnvFiles()

const MOCK_TAG = process.env.MOCK_SEED_TAG ?? "catus-prod-mock-v1"
const BASE_AT = new Date(process.env.MOCK_SEED_BASE_AT ?? "2026-05-30T14:00:00.000+09:00")
const USER_COUNT = readPositiveInt("MOCK_USER_COUNT", 32)
const POST_COUNT = readPositiveInt("MOCK_POST_COUNT", 150)
const ASSET_COUNT = readPositiveInt("MOCK_ASSET_COUNT", 72)
const SKIP_IMAGES = process.env.MOCK_SEED_SKIP_IMAGES === "true"

if (process.env.MOCK_SEED_CONFIRM !== "production") {
  throw new Error(
    "Refusing to write mock data. Run with MOCK_SEED_CONFIRM=production after checking the target DATABASE_URL.",
  )
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required")
}

const { PrismaClient } = await import("@prisma/client")
const prisma = new PrismaClient()

const appearances = [
  { id: 1, label: "단모" },
  { id: 2, label: "중장모" },
  { id: 3, label: "장모" },
  { id: 4, label: "치즈 🧀" },
  { id: 5, label: "삼색이 🌈" },
  { id: 6, label: "고등어 🐟" },
  { id: 7, label: "턱시도 👔" },
  { id: 8, label: "카오스 🍪" },
  { id: 9, label: "올블랙 🖤" },
  { id: 10, label: "올화이트 🤍" },
  { id: 11, label: "젖소 🐄" },
  { id: 12, label: "블루 💙" },
  { id: 13, label: "초콜릿 🍫" },
  { id: 14, label: "라일락 🩶" },
  { id: 15, label: "시나몬 🤎" },
]

const personalities = [
  { id: 1, label: "애교쟁이 💕" },
  { id: 2, label: "도도 ✨" },
  { id: 3, label: "겁쟁이 🥺" },
  { id: 4, label: "장난꾸러기 😜" },
  { id: 5, label: "차분 🌿" },
  { id: 6, label: "먹보 🍩" },
  { id: 7, label: "츤데레 😤" },
  { id: 8, label: "똑쟁이 📖" },
  { id: 9, label: "수다쟁이 💨" },
  { id: 10, label: "순둥이 🧸" },
  { id: 11, label: "소심 ☔" },
  { id: 12, label: "예민 🔥" },
]

const nicknames = [
  "모카집사",
  "나비보호자",
  "두부언니",
  "후추아빠",
  "보리누나",
  "루루친구",
  "망고형",
  "콩이엄마",
  "밤비집사",
  "쿠키보호자",
  "마루언니",
  "초코아빠",
  "라떼집사",
  "구름누나",
  "호두친구",
  "토리엄마",
  "단추집사",
  "복실언니",
  "젤리아빠",
  "미미보호자",
  "로로집사",
  "솜이누나",
  "까미친구",
  "레오아빠",
  "하루집사",
  "치즈언니",
  "먼지보호자",
  "바닐라엄마",
  "오레오집사",
  "삐삐누나",
  "쫀득아빠",
  "별이집사",
]

const catNames = [
  "모카",
  "나비",
  "두부",
  "후추",
  "보리",
  "루루",
  "망고",
  "콩이",
  "밤비",
  "쿠키",
  "마루",
  "초코",
  "라떼",
  "구름",
  "호두",
  "토리",
  "단추",
  "복실",
  "젤리",
  "미미",
  "로로",
  "솜이",
  "까미",
  "레오",
  "하루",
  "치즈",
  "먼지",
  "바닐라",
  "오레오",
  "삐삐",
  "쫀득",
  "별이",
  "우유",
  "달이",
  "깨비",
  "무무",
  "포도",
  "설탕",
  "버터",
  "루비",
]

const breeds = [
  "코리안 숏헤어",
  "브리티시 숏헤어",
  "러시안 블루",
  "페르시안",
  "랙돌",
  "먼치킨",
  "스코티시 폴드",
  "아메리칸 숏헤어",
  "노르웨이 숲",
  "터키시 앙고라",
  "샴",
  "메인쿤",
]

const postTemplates = [
  "{cat}가 오늘 아침 햇빛 자리를 완전히 점령했어요. 발끝까지 따뜻하게 충전 중입니다.",
  "새 장난감 테스트 완료. 처음 5분은 의심, 그 다음 30분은 우다다였어요.",
  "급수기 앞에서 물멍하는 시간이 길어졌습니다. 표정이 너무 진지해서 웃겼어요.",
  "병원 다녀온 뒤 간식으로 화해했습니다. 이동장은 아직 용서하지 않은 눈빛이에요.",
  "창밖 새 구경하다가 갑자기 꼬리가 두 배로 커졌어요.",
  "오늘의 식사 기록: 습식은 완식, 건식은 세 알 남기고 멋지게 퇴장.",
  "캣타워 꼭대기에서 집 안을 순찰 중입니다. 모든 동선이 감시되고 있어요.",
  "담요 속으로 사라졌다가 이름 부르니 귀만 빼꼼 나왔습니다.",
  "박스 하나로 하루 종일 행복해하는 중. 비싼 장난감은 잠시 잊기로 했어요.",
  "빗소리 듣는 오후. {cat}는 창가에서 조용히 졸고 있습니다.",
  "빗질 10분 성공했습니다. 털공 하나가 새로 태어났어요.",
  "오늘따라 수다 모드입니다. 대답을 안 하면 더 크게 불러요.",
  "발바닥 젤리가 너무 선명해서 사진을 안 찍을 수 없었습니다.",
  "새 쿠션 적응 완료. 이제 제 자리는 없어졌습니다.",
  "숨숨집 위치를 바꿨더니 탐험대처럼 들어갔다 나왔다 반복 중이에요.",
]

const commentTemplates = [
  "표정이 너무 사랑스러워요.",
  "오늘 사진 분위기 진짜 좋네요.",
  "발바닥 젤리 확대가 필요합니다.",
  "우리 집도 같은 반응이라 공감돼요.",
  "털 색 조합이 너무 예뻐요.",
  "건강하게 잘 지내는 모습 보기 좋아요.",
  "장난감 정보 궁금합니다.",
  "이름이랑 너무 잘 어울려요.",
  "창가 자리는 역시 고양이 전용이죠.",
  "간식으로 화해한 부분에서 웃었어요.",
  "사진 저장하고 싶을 정도예요.",
  "오늘 하루 피로가 풀립니다.",
]

async function main() {
  await prisma.$connect()

  const assets = SKIP_IMAGES ? fallbackAssets(ASSET_COUNT) : await uploadImageAssets(ASSET_COUNT)
  const users = buildUsers(assets)
  const cats = buildCats(users, assets)
  const posts = buildPosts(users, cats)
  const postImages = buildPostImages(posts, assets)
  const blockPairs = buildBlockPairs(users)
  const followPairs = buildFollowPairs(users, blockPairs)
  const comments = buildComments(users, posts)
  const postLikes = buildPostLikes(users, posts)
  const postBookmarks = buildPostBookmarks(users, posts)
  const commentLikes = buildCommentLikes(users, comments)
  const reports = buildReports(users, posts)
  const refreshTokens = buildRefreshTokens(users)
  const pushTokens = buildPushTokens(users)
  const notifications = buildNotifications(users, posts, comments)

  await seedTaxonomies()
  await seedUsers(users)
  await seedCats(cats)
  await seedPosts(posts)
  await seedPostImages(postImages)
  await seedUserBlocks(blockPairs)
  await seedFollows(followPairs)
  await syncFollowCounts(users)
  await seedComments(comments)
  await seedPostLikes(postLikes)
  await seedPostBookmarks(postBookmarks)
  await syncPostLikeCounts(posts)
  await seedCommentLikes(commentLikes)
  await syncCommentLikeCounts(comments)
  await seedReports(reports)
  await seedRefreshTokens(refreshTokens)
  await seedPushTokens(pushTokens)
  await seedNotifications(notifications)

  await printSummary(users, cats, posts, comments, assets)
}

function loadEnvFiles() {
  for (const fileName of [".env.production", ".env"]) {
    const filePath = join(process.cwd(), fileName)

    if (existsSync(filePath)) {
      loadEnvFile(filePath)
    }
  }
}

function readPositiveInt(name, fallback) {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function dateFromBase({ days = 0, hours = 0, minutes = 0 }) {
  return new Date(BASE_AT.getTime() + days * 86400000 + hours * 3600000 + minutes * 60000)
}

function uuidV7FromDate(date, seed) {
  const timeHex = BigInt(date.getTime()).toString(16).padStart(12, "0").slice(-12)
  const randomHex = createHash("sha256").update(`${MOCK_TAG}:${seed}`).digest("hex")
  const randA = randomHex.slice(0, 3)
  let randB = randomHex.slice(3, 19)
  randB = ((parseInt(randB[0], 16) & 0x3) | 0x8).toString(16) + randB.slice(1)
  const hex = `${timeHex}7${randA}${randB}`

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function stableHash(seed) {
  return createHash("sha256").update(`${MOCK_TAG}:${seed}`).digest("hex")
}

function pick(items, index) {
  return items[index % items.length]
}

function chooseTwo(max, index, step = 5) {
  const first = (index % max) + 1
  const second = ((index + step) % max) + 1

  return first === second ? [first] : [first, second]
}

function buildUsers(assets) {
  const providers = ["KAKAO", "GOOGLE", "APPLE"]

  return Array.from({ length: USER_COUNT }, (_, index) => {
    const createdAt = dateFromBase({ days: -75 + index, minutes: index * 7 })
    const provider = pick(providers, index)
    const identityId = `${MOCK_TAG}-${provider.toLowerCase()}-${String(index + 1).padStart(3, "0")}`

    return {
      id: uuidV7FromDate(createdAt, `user:${index}`),
      nickname: `${pick(nicknames, index)}_${String(index + 1).padStart(2, "0")}`,
      provider,
      identityId,
      kakaoId: provider === "KAKAO" ? identityId : null,
      isLivingWithCat: index % 9 !== 0,
      hasAgreedToTerms: true,
      phone: index % 5 === 0 ? null : `010-90${String(index).padStart(2, "0")}-${String(1000 + index).padStart(4, "0")}`,
      profileImageUrl: assets[index % assets.length].key,
      favoriteAppearanceIds: chooseTwo(appearances.length, index, 4),
      favoritePersonalityIds: chooseTwo(personalities.length, index, 3),
      createdAt,
    }
  })
}

function buildCats(users, assets) {
  const genders = ["MALE", "FEMALE", "UNKNOWN"]
  const cats = []

  for (const [userIndex, user] of users.entries()) {
    const catCount = 1 + (userIndex % 3 === 0 ? 1 : 0) + (userIndex % 8 === 0 ? 1 : 0)

    for (let localIndex = 0; localIndex < catCount; localIndex += 1) {
      const globalIndex = cats.length
      const createdAt = dateFromBase({ days: -60 + userIndex, hours: localIndex * 3 })

      cats.push({
        id: uuidV7FromDate(createdAt, `cat:${userIndex}:${localIndex}`),
        name: pick(catNames, globalIndex),
        gender: pick(genders, globalIndex),
        profileImageUrl: assets[(globalIndex + users.length) % assets.length].key,
        birthDate: dateFromBase({ days: -365 * (1 + (globalIndex % 12)) - (globalIndex % 28) }).toISOString().slice(0, 10),
        breed: pick(breeds, globalIndex),
        type: (globalIndex % appearances.length) + 1,
        butlerId: user.id,
        appearanceIds: chooseTwo(appearances.length, globalIndex, 6),
        personalityIds: chooseTwo(personalities.length, globalIndex, 5),
        createdAt,
      })
    }
  }

  return cats
}

function buildPosts(users, cats) {
  const catsByUserId = new Map()

  for (const cat of cats) {
    const ownedCats = catsByUserId.get(cat.butlerId) ?? []
    ownedCats.push(cat)
    catsByUserId.set(cat.butlerId, ownedCats)
  }

  return Array.from({ length: POST_COUNT }, (_, index) => {
    const author = users[index % users.length]
    const ownedCats = catsByUserId.get(author.id) ?? []
    const cat = index % 6 === 0 ? null : ownedCats[index % ownedCats.length]
    const createdAt =
      index < 45
        ? dateFromBase({ hours: -Math.floor(index / 3), minutes: -(index * 11) })
        : dateFromBase({ days: -Math.floor(index / 5), hours: -(index % 24), minutes: -(index * 3) })
    const template = pick(postTemplates, index)

    return {
      id: uuidV7FromDate(createdAt, `post:${index}`),
      authorId: author.id,
      catId: cat?.id ?? null,
      content: template.replaceAll("{cat}", cat?.name ?? "우리 고양이"),
      createdAt,
    }
  })
}

function buildPostImages(posts, assets) {
  return posts.flatMap((post, postIndex) => {
    const imageCount = postIndex % 10 === 0 ? 0 : 1 + (postIndex % 3)

    return Array.from({ length: imageCount }, (_, imageIndex) => {
      const asset = assets[(postIndex * 3 + imageIndex) % assets.length]

      return {
        id: uuidV7FromDate(post.createdAt, `post-image:${postIndex}:${imageIndex}`),
        postId: post.id,
        url: asset.key,
        order: imageIndex + 1,
      }
    })
  })
}

function buildBlockPairs(users) {
  return [2, 6, 10, 14, 18, 22, 26, 30]
    .filter((index) => index + 1 < users.length)
    .map((index, pairIndex) => ({
      blockerId: users[index].id,
      blockedId: users[index + 1].id,
      createdAt: dateFromBase({ days: -20 + pairIndex }),
    }))
}

function buildFollowPairs(users, blockPairs) {
  const blocked = new Set(
    blockPairs.flatMap((pair) => [
      `${pair.blockerId}:${pair.blockedId}`,
      `${pair.blockedId}:${pair.blockerId}`,
    ]),
  )
  const pairs = []
  const seen = new Set()

  for (const [index, user] of users.entries()) {
    const followCount = 6 + (index % 7)

    for (let offset = 1; offset <= followCount; offset += 1) {
      const target = users[(index + offset * 3 + (index % 5)) % users.length]
      const key = `${user.id}:${target.id}`

      if (user.id === target.id || seen.has(key) || blocked.has(key)) {
        continue
      }

      seen.add(key)
      pairs.push({
        followerId: user.id,
        followingId: target.id,
        createdAt: dateFromBase({ days: -35 + ((index + offset) % 30), minutes: index * 4 + offset }),
      })
    }
  }

  return pairs
}

function buildComments(users, posts) {
  const comments = []

  for (const [postIndex, post] of posts.entries()) {
    const topLevelCount = 2 + (postIndex % 4)
    const parentIds = []

    for (let commentIndex = 0; commentIndex < topLevelCount; commentIndex += 1) {
      const author = users[(postIndex + commentIndex * 5 + 2) % users.length]
      const createdAt = new Date(post.createdAt.getTime() + (commentIndex + 1) * 18 * 60000)
      const id = uuidV7FromDate(createdAt, `comment:${postIndex}:${commentIndex}`)

      comments.push({
        id,
        postId: post.id,
        authorId: author.id,
        parentId: null,
        content: pick(commentTemplates, postIndex + commentIndex),
        createdAt,
      })
      parentIds.push(id)
    }

    if (postIndex % 3 !== 0) {
      const replyCount = 1 + (postIndex % 2)

      for (let replyIndex = 0; replyIndex < replyCount; replyIndex += 1) {
        const author = users[(postIndex + replyIndex * 7 + 9) % users.length]
        const createdAt = new Date(post.createdAt.getTime() + (topLevelCount + replyIndex + 2) * 22 * 60000)

        comments.push({
          id: uuidV7FromDate(createdAt, `reply:${postIndex}:${replyIndex}`),
          postId: post.id,
          authorId: author.id,
          parentId: parentIds[replyIndex % parentIds.length],
          content: `${pick(commentTemplates, postIndex + replyIndex + 5)} 답글 남겨요.`,
          createdAt,
        })
      }
    }
  }

  return comments
}

function buildPostLikes(users, posts) {
  const likes = []
  const seen = new Set()

  for (const [postIndex, post] of posts.entries()) {
    const likeCount = 5 + (postIndex % 15) + (postIndex < 25 ? 10 : 0)

    for (let offset = 0; offset < likeCount; offset += 1) {
      const user = users[(postIndex * 2 + offset * 3 + 1) % users.length]
      const key = `${post.id}:${user.id}`

      if (user.id === post.authorId || seen.has(key)) {
        continue
      }

      seen.add(key)
      likes.push({
        postId: post.id,
        userId: user.id,
        createdAt:
          postIndex < 35
            ? dateFromBase({ hours: -Math.floor(offset / 4), minutes: -(postIndex + offset) })
            : dateFromBase({ days: -((postIndex + offset) % 28), hours: -(offset % 12) }),
      })
    }
  }

  return likes
}

function buildPostBookmarks(users, posts) {
  const bookmarks = []
  const seen = new Set()

  for (const [postIndex, post] of posts.entries()) {
    const bookmarkCount = 2 + (postIndex % 6)

    for (let offset = 0; offset < bookmarkCount; offset += 1) {
      const user = users[(postIndex + offset * 4 + 7) % users.length]
      const key = `${post.id}:${user.id}`

      if (seen.has(key)) {
        continue
      }

      seen.add(key)
      bookmarks.push({
        postId: post.id,
        userId: user.id,
        createdAt: dateFromBase({ days: -((postIndex + offset) % 40), minutes: offset * 13 }),
      })
    }
  }

  return bookmarks
}

function buildCommentLikes(users, comments) {
  const likes = []
  const seen = new Set()

  for (const [commentIndex, comment] of comments.entries()) {
    const likeCount = commentIndex % 7

    for (let offset = 0; offset < likeCount; offset += 1) {
      const user = users[(commentIndex + offset * 6 + 3) % users.length]
      const key = `${comment.id}:${user.id}`

      if (user.id === comment.authorId || seen.has(key)) {
        continue
      }

      seen.add(key)
      likes.push({
        commentId: comment.id,
        userId: user.id,
        createdAt: new Date(comment.createdAt.getTime() + (offset + 1) * 11 * 60000),
      })
    }
  }

  return likes
}

function buildReports(users, posts) {
  return posts
    .filter((_, index) => index % 17 === 0)
    .slice(0, 10)
    .flatMap((post, index) => {
      const reporters = [users[(index * 5 + 4) % users.length], users[(index * 7 + 11) % users.length]]

      return reporters
        .filter((reporter) => reporter.id !== post.authorId)
        .map((reporter) => ({
          postId: post.id,
          reporterId: reporter.id,
        }))
    })
}

function buildRefreshTokens(users) {
  return users.slice(0, 18).map((user, index) => ({
    id: uuidV7FromDate(dateFromBase({ days: -2, minutes: index }), `refresh-token:${index}`),
    tokenHash: stableHash(`refresh-token-hash:${user.id}`),
    userId: user.id,
    expiresAt: dateFromBase({ days: 30 + index }),
    revokedAt: index % 7 === 0 ? dateFromBase({ days: -1, minutes: index }) : null,
    createdAt: dateFromBase({ days: -7, minutes: index * 5 }),
  }))
}

function buildPushTokens(users) {
  return users.slice(0, 24).map((user, index) => ({
    token: `mock-disabled-push-token-${MOCK_TAG}-${String(index + 1).padStart(3, "0")}`,
    userId: user.id,
    platform: index % 2 === 0 ? "ios" : "android",
    enabled: false,
    lastUsedAt: dateFromBase({ days: -(index % 14), minutes: index }),
    createdAt: dateFromBase({ days: -30 + index }),
  }))
}

function buildNotifications(users, posts, comments) {
  return users.flatMap((user, index) => {
    const actor = users[(index + 5) % users.length]
    const post = posts[(index * 3) % posts.length]
    const comment = comments[(index * 7) % comments.length]

    return [
      {
        id: uuidV7FromDate(dateFromBase({ hours: -1, minutes: -index }), `notification:follow:${index}`),
        userId: user.id,
        title: "새로운 팔로워",
        body: `${actor.nickname}님이 회원님을 팔로우하기 시작했습니다`,
        data: { type: "USER_FOLLOWED", followerId: actor.id },
        readAt: index % 3 === 0 ? dateFromBase({ minutes: -index }) : null,
        createdAt: dateFromBase({ hours: -1, minutes: -index }),
      },
      {
        id: uuidV7FromDate(dateFromBase({ hours: -4, minutes: -index * 2 }), `notification:like:${index}`),
        userId: user.id,
        title: actor.nickname,
        body: "회원님의 게시물을 좋아합니다",
        data: { type: "POST_LIKE", actorId: actor.id, postId: post.id },
        readAt: index % 4 === 0 ? dateFromBase({ hours: -2, minutes: -index }) : null,
        createdAt: dateFromBase({ hours: -4, minutes: -index * 2 }),
      },
      {
        id: uuidV7FromDate(dateFromBase({ days: -1, minutes: -index * 3 }), `notification:comment:${index}`),
        userId: user.id,
        title: `${actor.nickname}님이 댓글을 남겼습니다`,
        body: comment.content.slice(0, 32),
        data: { type: "COMMENT_CREATED", actorId: actor.id, postId: comment.postId, commentId: comment.id },
        readAt: index % 5 === 0 ? dateFromBase({ hours: -8, minutes: -index }) : null,
        createdAt: dateFromBase({ days: -1, minutes: -index * 3 }),
      },
    ]
  })
}

async function seedTaxonomies() {
  for (const appearance of appearances) {
    await prisma.appearance.upsert({
      where: { id: appearance.id },
      update: { label: appearance.label },
      create: appearance,
    })
  }

  for (const personality of personalities) {
    await prisma.personality.upsert({
      where: { id: personality.id },
      update: { label: personality.label },
      create: personality,
    })
  }

  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('"appearance"', 'id'), (SELECT COALESCE(MAX(id), 1) FROM "appearance"))`,
  )
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('"personality"', 'id'), (SELECT COALESCE(MAX(id), 1) FROM "personality"))`,
  )
}

async function seedUsers(users) {
  for (const user of users) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: {
        kakaoId: user.kakaoId,
        nickname: user.nickname,
        isLivingWithCat: user.isLivingWithCat,
        hasAgreedToTerms: user.hasAgreedToTerms,
        phone: user.phone,
        profileImageUrl: user.profileImageUrl,
        createdAt: user.createdAt,
        favoriteAppearances: { set: user.favoriteAppearanceIds.map((id) => ({ id })) },
        favoritePersonalities: { set: user.favoritePersonalityIds.map((id) => ({ id })) },
      },
      create: {
        id: user.id,
        kakaoId: user.kakaoId,
        nickname: user.nickname,
        isLivingWithCat: user.isLivingWithCat,
        hasAgreedToTerms: user.hasAgreedToTerms,
        phone: user.phone,
        profileImageUrl: user.profileImageUrl,
        followerCount: 0,
        followingCount: 0,
        createdAt: user.createdAt,
        favoriteAppearances: { connect: user.favoriteAppearanceIds.map((id) => ({ id })) },
        favoritePersonalities: { connect: user.favoritePersonalityIds.map((id) => ({ id })) },
      },
    })

    await prisma.userIdentity.upsert({
      where: { provider_id: { provider: user.provider, id: user.identityId } },
      update: { userId: user.id },
      create: {
        provider: user.provider,
        id: user.identityId,
        userId: user.id,
        createdAt: user.createdAt,
      },
    })
  }
}

async function seedCats(cats) {
  for (const cat of cats) {
    await prisma.cat.upsert({
      where: { id: cat.id },
      update: {
        name: cat.name,
        gender: cat.gender,
        profileImageUrl: cat.profileImageUrl,
        birthDate: new Date(cat.birthDate),
        breed: cat.breed,
        type: cat.type,
        butlerId: cat.butlerId,
        createdAt: cat.createdAt,
        appearances: { set: cat.appearanceIds.map((id) => ({ id })) },
        personalities: { set: cat.personalityIds.map((id) => ({ id })) },
      },
      create: {
        id: cat.id,
        name: cat.name,
        gender: cat.gender,
        profileImageUrl: cat.profileImageUrl,
        birthDate: new Date(cat.birthDate),
        breed: cat.breed,
        type: cat.type,
        butlerId: cat.butlerId,
        createdAt: cat.createdAt,
        appearances: { connect: cat.appearanceIds.map((id) => ({ id })) },
        personalities: { connect: cat.personalityIds.map((id) => ({ id })) },
      },
    })
  }
}

async function seedPosts(posts) {
  for (const post of posts) {
    await prisma.post.upsert({
      where: { id: post.id },
      update: {
        authorId: post.authorId,
        catId: post.catId,
        content: post.content,
        createdAt: post.createdAt,
      },
      create: {
        id: post.id,
        authorId: post.authorId,
        catId: post.catId,
        content: post.content,
        likeCount: 0,
        createdAt: post.createdAt,
      },
    })
  }
}

async function seedPostImages(postImages) {
  for (const image of postImages) {
    await prisma.postImage.upsert({
      where: { id: image.id },
      update: {
        postId: image.postId,
        url: image.url,
        order: image.order,
      },
      create: image,
    })
  }
}

async function seedUserBlocks(blockPairs) {
  await prisma.userBlock.createMany({
    data: blockPairs,
    skipDuplicates: true,
  })
}

async function seedFollows(followPairs) {
  await prisma.follow.createMany({
    data: followPairs,
    skipDuplicates: true,
  })
}

async function syncFollowCounts(users) {
  for (const user of users) {
    const [followerCount, followingCount] = await Promise.all([
      prisma.follow.count({ where: { followingId: user.id } }),
      prisma.follow.count({ where: { followerId: user.id } }),
    ])

    await prisma.user.update({
      where: { id: user.id },
      data: { followerCount, followingCount },
    })
  }
}

async function seedComments(comments) {
  for (const comment of comments) {
    await prisma.comment.upsert({
      where: { id: comment.id },
      update: {
        postId: comment.postId,
        authorId: comment.authorId,
        parentId: comment.parentId,
        content: comment.content,
        createdAt: comment.createdAt,
      },
      create: {
        ...comment,
        likeCount: 0,
      },
    })
  }
}

async function seedPostLikes(postLikes) {
  await prisma.postLike.createMany({
    data: postLikes,
    skipDuplicates: true,
  })
}

async function seedPostBookmarks(postBookmarks) {
  await prisma.postBookmark.createMany({
    data: postBookmarks,
    skipDuplicates: true,
  })
}

async function syncPostLikeCounts(posts) {
  for (const post of posts) {
    const likeCount = await prisma.postLike.count({ where: { postId: post.id } })

    await prisma.post.update({
      where: { id: post.id },
      data: { likeCount },
    })
  }
}

async function seedCommentLikes(commentLikes) {
  await prisma.commentLike.createMany({
    data: commentLikes,
    skipDuplicates: true,
  })
}

async function syncCommentLikeCounts(comments) {
  for (const comment of comments) {
    const likeCount = await prisma.commentLike.count({ where: { commentId: comment.id } })

    await prisma.comment.update({
      where: { id: comment.id },
      data: { likeCount },
    })
  }
}

async function seedReports(reports) {
  await prisma.report.createMany({
    data: reports,
    skipDuplicates: true,
  })
}

async function seedRefreshTokens(refreshTokens) {
  for (const refreshToken of refreshTokens) {
    await prisma.refreshToken.upsert({
      where: { tokenHash: refreshToken.tokenHash },
      update: {
        userId: refreshToken.userId,
        expiresAt: refreshToken.expiresAt,
        revokedAt: refreshToken.revokedAt,
        createdAt: refreshToken.createdAt,
      },
      create: refreshToken,
    })
  }
}

async function seedPushTokens(pushTokens) {
  for (const pushToken of pushTokens) {
    await prisma.pushToken.upsert({
      where: { token: pushToken.token },
      update: {
        userId: pushToken.userId,
        platform: pushToken.platform,
        enabled: pushToken.enabled,
        lastUsedAt: pushToken.lastUsedAt,
      },
      create: pushToken,
    })
  }
}

async function seedNotifications(notifications) {
  for (const notification of notifications) {
    await prisma.notification.upsert({
      where: { id: notification.id },
      update: {
        userId: notification.userId,
        title: notification.title,
        body: notification.body,
        data: notification.data,
        readAt: notification.readAt,
        createdAt: notification.createdAt,
      },
      create: notification,
    })
  }
}

async function uploadImageAssets(count) {
  const bucket = process.env.S3_BUCKET ?? "catus-media"
  const endpoint = process.env.MOCK_S3_ENDPOINT ?? process.env.S3_ENDPOINT ?? process.env.MINIO_SERVER_URL

  if (!endpoint || !process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY) {
    throw new Error("S3_ENDPOINT, S3_ACCESS_KEY, and S3_SECRET_KEY are required unless MOCK_SEED_SKIP_IMAGES=true")
  }

  const s3 = new S3Client({
    region: process.env.S3_REGION ?? "ap-northeast-2",
    endpoint,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
  })

  await ensureBucket(s3, bucket)

  return mapLimit(
    Array.from({ length: count }, (_, index) => index),
    6,
    async (index) => {
      const image = await fetchImage(index)
      const ext = extensionForContentType(image.contentType)
      const key = `mock/assets/${MOCK_TAG}/cat-${String(index + 1).padStart(3, "0")}.${ext}`

      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: image.body,
          ContentType: image.contentType,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      )

      return { key, contentType: image.contentType, source: image.source }
    },
  )
}

async function ensureBucket(s3, bucket) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }))
    return
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode

    if (status !== 404 && err?.name !== "NoSuchBucket") {
      throw err
    }
  }

  await s3.send(new CreateBucketCommand({ Bucket: bucket }))

  try {
    await s3.send(
      new PutBucketPolicyCommand({
        Bucket: bucket,
        Policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "PublicReadGetObject",
              Effect: "Allow",
              Principal: "*",
              Action: ["s3:GetObject"],
              Resource: [`arn:aws:s3:::${bucket}/*`],
            },
          ],
        }),
      }),
    )
  } catch (err) {
    console.warn(`Bucket policy was not changed: ${err?.message ?? err}`)
  }
}

async function fetchImage(index) {
  const seed = `${MOCK_TAG}-${index + 1}`
  const sources = [
    `https://cataas.com/cat?width=1000&height=1000&seed=${encodeURIComponent(seed)}`,
    `https://loremflickr.com/1000/1000/cat?lock=${1000 + index}`,
    `https://picsum.photos/seed/${encodeURIComponent(seed)}/1000/1000`,
  ]

  for (const source of sources) {
    let timer

    try {
      const controller = new AbortController()
      timer = setTimeout(() => controller.abort(), 12000)
      const response = await fetch(source, {
        headers: { "User-Agent": "catus-production-mock-seed/1.0" },
        signal: controller.signal,
      })

      const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase()

      if (!response.ok || !contentType?.startsWith("image/")) {
        continue
      }

      return {
        body: Buffer.from(await response.arrayBuffer()),
        contentType,
        source,
      }
    } catch {
      continue
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    body: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#f7c873"/><stop offset="1" stop-color="#6bb8a9"/></linearGradient></defs><rect width="1000" height="1000" fill="url(#g)"/><circle cx="500" cy="520" r="245" fill="#fff8eb"/><path d="M330 345 430 205 468 390ZM670 345 570 205 532 390Z" fill="#fff8eb"/><circle cx="410" cy="505" r="34" fill="#222"/><circle cx="590" cy="505" r="34" fill="#222"/><path d="M470 590 Q500 620 530 590" fill="none" stroke="#222" stroke-width="24" stroke-linecap="round"/><text x="500" y="850" text-anchor="middle" font-size="54" font-family="Arial, sans-serif" fill="#222">Catus Mock ${index + 1}</text></svg>`,
    ),
    contentType: "image/svg+xml",
    source: "generated-svg-fallback",
  }
}

function extensionForContentType(contentType) {
  switch (contentType) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg"
    case "image/png":
      return "png"
    case "image/webp":
      return "webp"
    case "image/avif":
      return "avif"
    case "image/gif":
      return "gif"
    case "image/svg+xml":
      return "svg"
    default:
      return "jpg"
  }
}

function fallbackAssets(count) {
  return Array.from({ length: count }, (_, index) => ({
    key: `mock/assets/${MOCK_TAG}/cat-${String(index + 1).padStart(3, "0")}.svg`,
    contentType: "image/svg+xml",
    source: "skipped",
  }))
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))

  return results
}

async function printSummary(users, cats, posts, comments, assets) {
  const [
    userCount,
    catCount,
    postCount,
    postImageCount,
    commentCount,
    followCount,
    blockCount,
    postLikeCount,
    bookmarkCount,
    commentLikeCount,
    reportCount,
    refreshTokenCount,
    pushTokenCount,
    notificationCount,
  ] = await prisma.$transaction([
    prisma.user.count({ where: { id: { in: users.map((item) => item.id) } } }),
    prisma.cat.count({ where: { id: { in: cats.map((item) => item.id) } } }),
    prisma.post.count({ where: { id: { in: posts.map((item) => item.id) } } }),
    prisma.postImage.count({ where: { postId: { in: posts.map((item) => item.id) } } }),
    prisma.comment.count({ where: { id: { in: comments.map((item) => item.id) } } }),
    prisma.follow.count({ where: { followerId: { in: users.map((item) => item.id) } } }),
    prisma.userBlock.count({ where: { blockerId: { in: users.map((item) => item.id) } } }),
    prisma.postLike.count({ where: { postId: { in: posts.map((item) => item.id) } } }),
    prisma.postBookmark.count({ where: { postId: { in: posts.map((item) => item.id) } } }),
    prisma.commentLike.count({ where: { commentId: { in: comments.map((item) => item.id) } } }),
    prisma.report.count({ where: { postId: { in: posts.map((item) => item.id) } } }),
    prisma.refreshToken.count({ where: { userId: { in: users.map((item) => item.id) } } }),
    prisma.pushToken.count({ where: { userId: { in: users.map((item) => item.id) } } }),
    prisma.notification.count({ where: { userId: { in: users.map((item) => item.id) } } }),
  ])

  console.log(
    JSON.stringify(
      {
        tag: MOCK_TAG,
        baseAt: BASE_AT.toISOString(),
        assets: assets.length,
        users: userCount,
        cats: catCount,
        posts: postCount,
        postImages: postImageCount,
        comments: commentCount,
        follows: followCount,
        userBlocks: blockCount,
        postLikes: postLikeCount,
        postBookmarks: bookmarkCount,
        commentLikes: commentLikeCount,
        reports: reportCount,
        refreshTokens: refreshTokenCount,
        pushTokens: pushTokenCount,
        notifications: notificationCount,
      },
      null,
      2,
    ),
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
