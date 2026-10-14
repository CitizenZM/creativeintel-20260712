-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ContentType" ADD VALUE 'YOUTUBE_SHORT';
ALTER TYPE "ContentType" ADD VALUE 'TIKTOK_VIDEO';
ALTER TYPE "ContentType" ADD VALUE 'VIMEO_VIDEO';
ALTER TYPE "ContentType" ADD VALUE 'META_AD';
ALTER TYPE "ContentType" ADD VALUE 'TIKTOK_AD';
ALTER TYPE "ContentType" ADD VALUE 'GOOGLE_AD';
ALTER TYPE "ContentType" ADD VALUE 'INSTAGRAM_REEL';

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "actorSettings" JSONB,
ADD COLUMN     "brandProfileId" TEXT,
ADD COLUMN     "displayGuidelines" JSONB,
ADD COLUMN     "productCategory" TEXT,
ADD COLUMN     "productDescription" TEXT,
ADD COLUMN     "productImages" JSONB,
ADD COLUMN     "productVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "useEnvironments" JSONB;

-- AlterTable
ALTER TABLE "Competitor" ADD COLUMN     "competitorProfileId" TEXT,
ADD COLUMN     "excluded" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ContentAsset" ADD COLUMN     "adConfidence" DOUBLE PRECISION,
ADD COLUMN     "adEvidence" TEXT,
ADD COLUMN     "adLibraryId" TEXT,
ADD COLUMN     "adSource" TEXT,
ADD COLUMN     "adSpendEstimate" JSONB,
ADD COLUMN     "advertiserId" TEXT,
ADD COLUMN     "advertiserName" TEXT,
ADD COLUMN     "aspectRatio" TEXT,
ADD COLUMN     "contentCategory" TEXT,
ADD COLUMN     "durationSec" DOUBLE PRECISION,
ADD COLUMN     "excluded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "firstSeenAt" TIMESTAMP(3),
ADD COLUMN     "format" TEXT,
ADD COLUMN     "frameUrls" JSONB,
ADD COLUMN     "isPaidMedia" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "landingUrl" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "pinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rankInOwner" INTEGER,
ADD COLUMN     "videoUrl" TEXT;

-- AlterTable
ALTER TABLE "Insight" ADD COLUMN     "competitorId" TEXT,
ADD COLUMN     "selected" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "NarrativePattern" ADD COLUMN     "dismissed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "selected" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "analysisFingerprint" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "brandProfileId" TEXT,
ADD COLUMN     "briefingParsed" TEXT,
ADD COLUMN     "briefingText" TEXT,
ADD COLUMN     "budgetUsd" DOUBLE PRECISION,
ADD COLUMN     "campaignPlan" JSONB,
ADD COLUMN     "campaignPlanAt" TIMESTAMP(3),
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "creativeEditHistory" JSONB,
ADD COLUMN     "fieldStatus" JSONB,
ADD COLUMN     "goalType" TEXT,
ADD COLUMN     "imageAdSets" JSONB,
ADD COLUMN     "libtvCanvasUuid" TEXT,
ADD COLUMN     "mediaPlan" JSONB,
ADD COLUMN     "mediaPlanAt" TIMESTAMP(3),
ADD COLUMN     "nextRound" JSONB,
ADD COLUMN     "nextRoundAt" TIMESTAMP(3),
ADD COLUMN     "productBrief" JSONB,
ADD COLUMN     "productBriefAt" TIMESTAMP(3),
ADD COLUMN     "productConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "productName" TEXT,
ADD COLUMN     "productPageImages" JSONB,
ADD COLUMN     "productPageText" TEXT,
ADD COLUMN     "productPageTitle" TEXT,
ADD COLUMN     "productUrl" TEXT,
ADD COLUMN     "reportDelivery" JSONB,
ADD COLUMN     "spentUsd" DOUBLE PRECISION,
ADD COLUMN     "testPlan" JSONB,
ADD COLUMN     "testPlanAt" TIMESTAMP(3),
ADD COLUMN     "userProductImages" JSONB,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "ResearchJob" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Script" ADD COLUMN     "bodyBeats" JSONB,
ADD COLUMN     "complianceNotes" JSONB,
ADD COLUMN     "cta" JSONB,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "environmentName" TEXT,
ADD COLUMN     "hook" JSONB,
ADD COLUMN     "platform" TEXT,
ADD COLUMN     "platformTechniques" JSONB,
ADD COLUMN     "roleName" TEXT,
ADD COLUMN     "scenes" JSONB,
ADD COLUMN     "selectedCtaIdx" INTEGER,
ADD COLUMN     "selectedHookIdx" INTEGER,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'draft',
ADD COLUMN     "template" TEXT,
ADD COLUMN     "totalDurationSec" INTEGER,
ADD COLUMN     "videoType" TEXT;

-- AlterTable
ALTER TABLE "SellingPoint" ADD COLUMN     "addedByUser" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dismissed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "selected" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Storyboard" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "frameHistory" JSONB,
ADD COLUMN     "frameSeconds" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppUser" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'active',
    "monthlyAllowanceUsd" DOUBLE PRECISION,
    "legalAcceptedAt" TIMESTAMP(3),
    "legalVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "category" TEXT,
    "brandPromise" TEXT,
    "valueProposition" TEXT,
    "toneOfVoice" TEXT,
    "targetAudience" TEXT,
    "pricingTheme" TEXT,
    "productFeatures" JSONB,
    "ctaLanguage" JSONB,
    "socialProof" JSONB,
    "lastCrawledAt" TIMESTAMP(3),
    "rawCrawlData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "brandPromise" TEXT,
    "valueProposition" TEXT,
    "toneOfVoice" TEXT,
    "pricingTheme" TEXT,
    "productFeatures" JSONB,
    "ctaLanguage" JSONB,
    "socialProof" JSONB,
    "strengths" JSONB,
    "weaknesses" JSONB,
    "lastCrawledAt" TIMESTAMP(3),
    "rawCrawlData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlCache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrawlCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "key" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "projectId" TEXT,
    "response" JSONB NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 200,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AdTeardown" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contentAssetId" TEXT NOT NULL,
    "competitorId" TEXT,
    "rank" INTEGER,
    "hookType" TEXT NOT NULL,
    "hookText" TEXT NOT NULL,
    "hookVisual" TEXT NOT NULL,
    "beats" JSONB NOT NULL,
    "sellingPoints" JSONB NOT NULL,
    "proofDevices" JSONB NOT NULL,
    "ctaText" TEXT,
    "ctaPlacement" TEXT,
    "offer" TEXT,
    "landingUrl" TEXT,
    "whyItWorks" TEXT NOT NULL,
    "evidenceLevel" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdTeardown_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorRollup" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "topAssetIds" JSONB NOT NULL,
    "dominantHooks" JSONB NOT NULL,
    "dominantFormats" JSONB NOT NULL,
    "offerLadder" JSONB NOT NULL,
    "ctaPatterns" JSONB NOT NULL,
    "cadence" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitorRollup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "total" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "steps" JSONB,
    "input" JSONB,
    "result" JSONB,
    "error" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "workerId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("workerId")
);

-- CreateTable
CREATE TABLE "LibtvBalance" (
    "id" TEXT NOT NULL,
    "balance" INTEGER NOT NULL,
    "note" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibtvBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Angle" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "targetEmotion" TEXT,
    "narrativeType" TEXT,
    "videoType" TEXT,
    "templateIds" JSONB,
    "predictedScore" DOUBLE PRECISION,
    "rationale" TEXT,
    "targetAudience" TEXT,
    "platform" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Angle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandKit" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "colorsHex" JSONB,
    "fonts" JSONB,
    "ctaOptions" JSONB,
    "offerText" TEXT,
    "landingUrl" TEXT,
    "claimsAllowed" JSONB,
    "claimsForbidden" JSONB,
    "toneGuidelines" TEXT,
    "doNotShow" JSONB,
    "skuName" TEXT,
    "skuDimensionsCm" JSONB,
    "productSummary" TEXT,
    "completenessScore" INTEGER NOT NULL DEFAULT 0,
    "fieldStatus" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandKit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandAsset" (
    "id" TEXT NOT NULL,
    "brandKitId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "variant" TEXT,
    "url" TEXT NOT NULL,
    "publicId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'cloudinary',
    "width" INTEGER,
    "height" INTEGER,
    "format" TEXT,
    "bytes" INTEGER,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerTask" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "workerId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibtvRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scriptId" TEXT,
    "storyboardId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "canvasUuid" TEXT,
    "canvasUrl" TEXT,
    "canvasName" TEXT,
    "executor" TEXT NOT NULL DEFAULT 'libtv',
    "imageModel" TEXT NOT NULL DEFAULT 'Seedream 4.0',
    "videoModel" TEXT NOT NULL DEFAULT 'Hailuo 2.3 Fast',
    "aspectRatio" TEXT NOT NULL DEFAULT '9:16',
    "clipDurationSec" INTEGER NOT NULL DEFAULT 6,
    "creditsEstimated" INTEGER NOT NULL DEFAULT 0,
    "creditsSpent" INTEGER NOT NULL DEFAULT 0,
    "creditCap" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "masterMp4Url" TEXT,
    "voiceoverUrl" TEXT,
    "subtitlesUrl" TEXT,
    "qcReport" JSONB,
    "directorPlan" JSONB,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "parentRunId" TEXT,
    "previewMp4Url" TEXT,
    "contactSheetUrl" TEXT,
    "error" TEXT,
    "workerId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedBudgetUsd" DOUBLE PRECISION,

    CONSTRAINT "LibtvRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibtvJob" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "shotIndex" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "nodeName" TEXT NOT NULL,
    "nodeId" TEXT,
    "leftRefs" JSONB,
    "prompt" TEXT NOT NULL,
    "modelName" TEXT,
    "settings" JSONB,
    "sourceUrl" TEXT,
    "creditsEstimated" INTEGER NOT NULL DEFAULT 0,
    "creditsSpent" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "resultUrl" TEXT,
    "remoteUrl" TEXT,
    "localPath" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibtvJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenderJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "outputPath" TEXT,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenderJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FalVideoJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "falRequestId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "aspectRatio" TEXT NOT NULL DEFAULT '9:16',
    "resolution" TEXT NOT NULL DEFAULT '720p',
    "duration" INTEGER NOT NULL DEFAULT 5,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "videoUrl" TEXT,
    "thumbnailUrl" TEXT,
    "fileSizeBytes" INTEGER,
    "widthPx" INTEGER,
    "heightPx" INTEGER,
    "fpS" DOUBLE PRECISION,
    "durationSec" DOUBLE PRECISION,
    "scriptId" TEXT,
    "shotIndex" INTEGER,
    "promptVersion" INTEGER NOT NULL DEFAULT 1,
    "costUsd" DOUBLE PRECISION,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "FalVideoJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoReference" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contentAssetId" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "localPath" TEXT,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "transcript" TEXT,
    "language" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeepAnalysis" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "videoStructure" JSONB,
    "vibeAnalysis" JSONB,
    "ctaAnalysis" JSONB,
    "sellingPointDeep" JSONB,
    "competitiveGaps" JSONB,
    "recommendations" JSONB,
    "environmentAnalysis" JSONB,
    "cameraAngles" JSONB,
    "hookFormulas" JSONB,
    "platformInsights" JSONB,
    "sellingPointVisuals" JSONB,
    "videoTimeline" JSONB,
    "dataSource" "DataSource" NOT NULL DEFAULT 'AI_INFERRED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeepAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignSelection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "selectedProductName" TEXT,
    "selectedProductImage" TEXT,
    "selectedEnvironment" TEXT,
    "selectedEnvImage" TEXT,
    "selectedEnvNotes" TEXT,
    "selectedActorRole" TEXT,
    "selectedActorImage" TEXT,
    "selectedActorDesc" TEXT,
    "selectedActorAge" TEXT,
    "selectedSellingPoints" JSONB,
    "videoTimeline" JSONB,
    "totalDurationSec" INTEGER NOT NULL DEFAULT 30,
    "platform" TEXT,
    "referenceVideoIds" JSONB,
    "styleCategories" JSONB,
    "structureId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignSelection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudienceProfile" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "segments" JSONB,
    "psychographics" JSONB,
    "painPoints" JSONB,
    "interests" JSONB,
    "platforms" JSONB,
    "buyingBehavior" TEXT,
    "incomeLevel" TEXT,
    "geoMarkets" JSONB,
    "dataSource" "DataSource" NOT NULL DEFAULT 'AI_INFERRED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AudienceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveredVideo" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "channelTitle" TEXT,
    "thumbnailUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "viewCount" INTEGER,
    "likeCount" INTEGER,
    "commentCount" INTEGER,
    "relevanceScore" DOUBLE PRECISION,
    "qualityScore" DOUBLE PRECISION,
    "combinedScore" DOUBLE PRECISION,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "brands" JSONB,
    "workspaceId" TEXT,
    "seenCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveredVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrowserGenJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "model" TEXT,
    "prompt" TEXT NOT NULL,
    "negativePrompt" TEXT,
    "inputImageUrl" TEXT,
    "aspectRatio" TEXT NOT NULL DEFAULT '9:16',
    "durationSec" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "resultUrl" TEXT,
    "error" TEXT,
    "workerId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "scriptId" TEXT,
    "shotIndex" INTEGER,
    "promptVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BrowserGenJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ModelProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "baseUrl" TEXT,
    "apiKeyEnc" TEXT NOT NULL,
    "keyLast4" TEXT NOT NULL,
    "models" JSONB NOT NULL,
    "prices" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "images" INTEGER NOT NULL DEFAULT 0,
    "videoSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdPerformance" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'csv',
    "adName" TEXT NOT NULL,
    "hookStyle" TEXT,
    "format" TEXT,
    "dateFrom" TIMESTAMP(3),
    "dateTo" TIMESTAMP(3),
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "views3s" INTEGER NOT NULL DEFAULT 0,
    "thruplays" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "perfRevenue" DOUBLE PRECISION,

    CONSTRAINT "AdPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerfElementMap" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "adName" TEXT NOT NULL,
    "runId" TEXT,
    "hookId" TEXT,
    "endCardId" TEXT,
    "voice" TEXT,
    "aspect" TEXT,
    "durationSec" INTEGER,
    "sellingPointId" TEXT,
    "platform" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerfElementMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdStructure" (
    "id" TEXT NOT NULL,
    "sourceProjectId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "goalType" TEXT,
    "sourceTitle" TEXT NOT NULL,
    "sourceOwner" TEXT,
    "sourceUrl" TEXT,
    "sourceViews" INTEGER,
    "hookType" TEXT,
    "hookText" TEXT,
    "durationSec" DOUBLE PRECISION,
    "beats" JSONB NOT NULL,
    "proofDevices" JSONB,
    "whyItWorks" TEXT,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "sourceTeardownId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpendEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT,
    "jobId" TEXT,
    "kind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "estUsd" DOUBLE PRECISION NOT NULL,
    "actualUsd" DOUBLE PRECISION,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpendEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopilotRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "step" TEXT NOT NULL DEFAULT 'scrape',
    "input" JSONB NOT NULL,
    "state" JSONB NOT NULL,
    "error" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsEvent" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "issueCode" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "projectId" TEXT,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CronHeartbeat" (
    "name" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runs" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CronHeartbeat_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "CatalogRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "format" TEXT,
    "products" JSONB NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'image',
    "status" TEXT NOT NULL DEFAULT 'imported',
    "results" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportDelivery" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "target" TEXT,
    "status" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectArtifact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "runId" TEXT,
    "jobId" TEXT,
    "storyboardId" TEXT,
    "sourceField" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "url" TEXT,
    "contentType" TEXT,
    "bytes" INTEGER,
    "sha256" TEXT,
    "content" JSONB,
    "meta" JSONB,
    "producedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtifactBlob" (
    "artifactId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtifactBlob_pkey" PRIMARY KEY ("artifactId")
);

-- CreateTable
CREATE TABLE "ProjectShare" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "access" TEXT NOT NULL DEFAULT 'view',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "Workspace_ownerId_idx" ON "Workspace"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "AppUser_clerkUserId_key" ON "AppUser"("clerkUserId");

-- CreateIndex
CREATE INDEX "AppUser_email_idx" ON "AppUser"("email");

-- CreateIndex
CREATE INDEX "BrandProfile_workspaceId_lastCrawledAt_idx" ON "BrandProfile"("workspaceId", "lastCrawledAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrandProfile_workspaceId_name_key" ON "BrandProfile"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "CompetitorProfile_workspaceId_lastCrawledAt_idx" ON "CompetitorProfile"("workspaceId", "lastCrawledAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorProfile_workspaceId_name_key" ON "CompetitorProfile"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CrawlCache_cacheKey_key" ON "CrawlCache"("cacheKey");

-- CreateIndex
CREATE INDEX "CrawlCache_kind_expiresAt_idx" ON "CrawlCache"("kind", "expiresAt");

-- CreateIndex
CREATE INDEX "CrawlCache_expiresAt_idx" ON "CrawlCache"("expiresAt");

-- CreateIndex
CREATE INDEX "IdempotencyKey_projectId_route_idx" ON "IdempotencyKey"("projectId", "route");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdTeardown_contentAssetId_key" ON "AdTeardown"("contentAssetId");

-- CreateIndex
CREATE INDEX "AdTeardown_projectId_competitorId_rank_idx" ON "AdTeardown"("projectId", "competitorId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorRollup_competitorId_key" ON "CompetitorRollup"("competitorId");

-- CreateIndex
CREATE INDEX "CompetitorRollup_projectId_idx" ON "CompetitorRollup"("projectId");

-- CreateIndex
CREATE INDEX "Job_projectId_kind_createdAt_idx" ON "Job"("projectId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "Angle_projectId_deletedAt_idx" ON "Angle"("projectId", "deletedAt");

-- CreateIndex
CREATE INDEX "Angle_projectId_batchId_idx" ON "Angle"("projectId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandKit_projectId_key" ON "BrandKit"("projectId");

-- CreateIndex
CREATE INDEX "BrandAsset_brandKitId_kind_idx" ON "BrandAsset"("brandKitId", "kind");

-- CreateIndex
CREATE INDEX "WorkerTask_status_kind_priority_idx" ON "WorkerTask"("status", "kind", "priority");

-- CreateIndex
CREATE INDEX "WorkerTask_projectId_kind_idx" ON "WorkerTask"("projectId", "kind");

-- CreateIndex
CREATE INDEX "WorkerTask_status_updatedAt_idx" ON "WorkerTask"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "LibtvRun_projectId_status_idx" ON "LibtvRun"("projectId", "status");

-- CreateIndex
CREATE INDEX "LibtvRun_status_idx" ON "LibtvRun"("status");

-- CreateIndex
CREATE INDEX "LibtvJob_runId_status_idx" ON "LibtvJob"("runId", "status");

-- CreateIndex
CREATE INDEX "LibtvJob_projectId_idx" ON "LibtvJob"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "LibtvJob_runId_nodeName_key" ON "LibtvJob"("runId", "nodeName");

-- CreateIndex
CREATE INDEX "RenderJob_projectId_status_idx" ON "RenderJob"("projectId", "status");

-- CreateIndex
CREATE INDEX "RenderJob_projectId_createdAt_idx" ON "RenderJob"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FalVideoJob_falRequestId_key" ON "FalVideoJob"("falRequestId");

-- CreateIndex
CREATE INDEX "FalVideoJob_projectId_status_idx" ON "FalVideoJob"("projectId", "status");

-- CreateIndex
CREATE INDEX "FalVideoJob_projectId_createdAt_idx" ON "FalVideoJob"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VideoReference_contentAssetId_key" ON "VideoReference"("contentAssetId");

-- CreateIndex
CREATE INDEX "VideoReference_projectId_platform_idx" ON "VideoReference"("projectId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "VideoReference_projectId_sourceUrl_key" ON "VideoReference"("projectId", "sourceUrl");

-- CreateIndex
CREATE UNIQUE INDEX "DeepAnalysis_projectId_key" ON "DeepAnalysis"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignSelection_projectId_key" ON "CampaignSelection"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "AudienceProfile_projectId_key" ON "AudienceProfile"("projectId");

-- CreateIndex
CREATE INDEX "DiscoveredVideo_workspaceId_idx" ON "DiscoveredVideo"("workspaceId");

-- CreateIndex
CREATE INDEX "DiscoveredVideo_combinedScore_idx" ON "DiscoveredVideo"("combinedScore");

-- CreateIndex
CREATE INDEX "DiscoveredVideo_platform_idx" ON "DiscoveredVideo"("platform");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredVideo_platform_videoId_key" ON "DiscoveredVideo"("platform", "videoId");

-- CreateIndex
CREATE INDEX "BrowserGenJob_status_site_idx" ON "BrowserGenJob"("status", "site");

-- CreateIndex
CREATE INDEX "BrowserGenJob_projectId_idx" ON "BrowserGenJob"("projectId");

-- CreateIndex
CREATE INDEX "BrowserGenJob_scriptId_idx" ON "BrowserGenJob"("scriptId");

-- CreateIndex
CREATE UNIQUE INDEX "ModelProvider_name_key" ON "ModelProvider"("name");

-- CreateIndex
CREATE INDEX "AiUsage_createdAt_idx" ON "AiUsage"("createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_projectId_createdAt_idx" ON "AiUsage"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AdPerformance_projectId_hookStyle_idx" ON "AdPerformance"("projectId", "hookStyle");

-- CreateIndex
CREATE UNIQUE INDEX "AdPerformance_projectId_platform_adName_dateFrom_key" ON "AdPerformance"("projectId", "platform", "adName", "dateFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PerfElementMap_projectId_adName_key" ON "PerfElementMap"("projectId", "adName");

-- CreateIndex
CREATE UNIQUE INDEX "AdStructure_sourceTeardownId_key" ON "AdStructure"("sourceTeardownId");

-- CreateIndex
CREATE INDEX "AdStructure_category_idx" ON "AdStructure"("category");

-- CreateIndex
CREATE INDEX "SpendEntry_projectId_createdAt_idx" ON "SpendEntry"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "SpendEntry_runId_idx" ON "SpendEntry"("runId");

-- CreateIndex
CREATE INDEX "SpendEntry_jobId_idx" ON "SpendEntry"("jobId");

-- CreateIndex
CREATE INDEX "SpendEntry_actorId_createdAt_idx" ON "SpendEntry"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AutopilotRun_status_updatedAt_idx" ON "AutopilotRun"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "AutopilotRun_projectId_idx" ON "AutopilotRun"("projectId");

-- CreateIndex
CREATE INDEX "OpsEvent_createdAt_idx" ON "OpsEvent"("createdAt");

-- CreateIndex
CREATE INDEX "OpsEvent_action_createdAt_idx" ON "OpsEvent"("action", "createdAt");

-- CreateIndex
CREATE INDEX "CatalogRun_projectId_createdAt_idx" ON "CatalogRun"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ReportDelivery_projectId_createdAt_idx" ON "ReportDelivery"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectArtifact_projectId_kind_idx" ON "ProjectArtifact"("projectId", "kind");

-- CreateIndex
CREATE INDEX "ProjectArtifact_projectId_createdAt_idx" ON "ProjectArtifact"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectArtifact_runId_idx" ON "ProjectArtifact"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectArtifact_projectId_sourceKey_version_key" ON "ProjectArtifact"("projectId", "sourceKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectArtifact_projectId_sourceKey_fingerprint_key" ON "ProjectArtifact"("projectId", "sourceKey", "fingerprint");

-- CreateIndex
CREATE INDEX "ProjectShare_userId_idx" ON "ProjectShare"("userId");

-- CreateIndex
CREATE INDEX "ProjectShare_email_idx" ON "ProjectShare"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectShare_projectId_email_key" ON "ProjectShare"("projectId", "email");

-- CreateIndex
CREATE INDEX "Competitor_projectId_excluded_createdAt_idx" ON "Competitor"("projectId", "excluded", "createdAt");

-- CreateIndex
CREATE INDEX "ContentAsset_projectId_isPaidMedia_idx" ON "ContentAsset"("projectId", "isPaidMedia");

-- CreateIndex
CREATE INDEX "ContentAsset_projectId_competitorId_rankInOwner_idx" ON "ContentAsset"("projectId", "competitorId", "rankInOwner");

-- CreateIndex
CREATE UNIQUE INDEX "ContentAsset_projectId_url_key" ON "ContentAsset"("projectId", "url");

-- CreateIndex
CREATE INDEX "Insight_projectId_competitorId_idx" ON "Insight"("projectId", "competitorId");

-- CreateIndex
CREATE INDEX "Project_workspaceId_updatedAt_idx" ON "Project"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "Script_projectId_videoType_idx" ON "Script"("projectId", "videoType");

-- CreateIndex
CREATE INDEX "Script_projectId_deletedAt_idx" ON "Script"("projectId", "deletedAt");

-- CreateIndex
CREATE INDEX "Storyboard_projectId_scriptId_idx" ON "Storyboard"("projectId", "scriptId");

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandProfile" ADD CONSTRAINT "BrandProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorProfile" ADD CONSTRAINT "CompetitorProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_brandProfileId_fkey" FOREIGN KEY ("brandProfileId") REFERENCES "BrandProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_brandProfileId_fkey" FOREIGN KEY ("brandProfileId") REFERENCES "BrandProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_competitorProfileId_fkey" FOREIGN KEY ("competitorProfileId") REFERENCES "CompetitorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdTeardown" ADD CONSTRAINT "AdTeardown_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdTeardown" ADD CONSTRAINT "AdTeardown_contentAssetId_fkey" FOREIGN KEY ("contentAssetId") REFERENCES "ContentAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdTeardown" ADD CONSTRAINT "AdTeardown_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorRollup" ADD CONSTRAINT "CompetitorRollup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorRollup" ADD CONSTRAINT "CompetitorRollup_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insight" ADD CONSTRAINT "Insight_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Angle" ADD CONSTRAINT "Angle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandKit" ADD CONSTRAINT "BrandKit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandAsset" ADD CONSTRAINT "BrandAsset_brandKitId_fkey" FOREIGN KEY ("brandKitId") REFERENCES "BrandKit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibtvRun" ADD CONSTRAINT "LibtvRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibtvJob" ADD CONSTRAINT "LibtvJob_runId_fkey" FOREIGN KEY ("runId") REFERENCES "LibtvRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderJob" ADD CONSTRAINT "RenderJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FalVideoJob" ADD CONSTRAINT "FalVideoJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoReference" ADD CONSTRAINT "VideoReference_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeepAnalysis" ADD CONSTRAINT "DeepAnalysis_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSelection" ADD CONSTRAINT "CampaignSelection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudienceProfile" ADD CONSTRAINT "AudienceProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdPerformance" ADD CONSTRAINT "AdPerformance_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerfElementMap" ADD CONSTRAINT "PerfElementMap_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactBlob" ADD CONSTRAINT "ArtifactBlob_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "ProjectArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectShare" ADD CONSTRAINT "ProjectShare_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectShare" ADD CONSTRAINT "ProjectShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
