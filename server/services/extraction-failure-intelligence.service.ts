import { createHash } from "node:crypto";
import { desc, eq, isNotNull, sql } from "drizzle-orm";
import {
  extractionFailures,
  type ExtractionFailure as StoredExtractionFailure,
} from "../../drizzle/schema";
import { requireDb } from "../_core/db-assert";
import { ENV } from "../_core/env";
import { logger } from "../_core/logger";
import {
  EXTRACTOR_VERSION,
  type DeterministicProductData,
  type ExtractionEvidence,
  type ExtractionFailureReason,
  type ExtractionResolution,
  type ProductMatchAssessment,
} from "./product-content-extraction";
import type {
  ExtractionReplayFixture,
  ReplayExpectedResult,
} from "./extractor-evaluation.service";

export type StorefrontPlatform =
  | "shopify"
  | "woocommerce"
  | "magento"
  | "bigcommerce"
  | "custom"
  | "unknown";

export interface PlatformFingerprint {
  platform: StorefrontPlatform;
  markers: string[];
  markerFingerprint: string;
}

export interface FailureRecordInput {
  productId: string;
  competitorId?: string;
  domain: string;
  sourceUrl: string;
  contentHash: string;
  reducedContent: string;
  pageContentForFingerprint: string;
  deterministic: DeterministicProductData | null;
  matchAssessment?: ProductMatchAssessment | null;
  aiDecision?: unknown;
}

export interface PreparedFailureRecord {
  failureKey: string;
  productId: string;
  competitorId: string | null;
  domain: string;
  sourceUrl: string | null;
  contentHash: string;
  extractorVersion: string;
  resolutionState: ExtractionResolution["state"];
  failureReasons: ExtractionFailureReason[];
  platform: StorefrontPlatform;
  markerFingerprint: string;
  markers: string[];
  productEvidence: ExtractionEvidence[];
  variantEvidence: ExtractionEvidence[];
  priceEvidence: ExtractionEvidence[];
  candidateCount: number;
  confidence: number;
  scoreBreakdown: ExtractionResolution["breakdown"];
  reducedContent: string;
  deterministicDecision: unknown;
  aiDecision: unknown;
}

export interface FailureCluster {
  clusterKey: string;
  domain: string;
  platform: StorefrontPlatform;
  failureReason: ExtractionFailureReason;
  markerFingerprint: string;
  markers: string[];
  affectedFailureCount: number;
  failures: StoredExtractionFailure[];
  representativeFailures: StoredExtractionFailure[];
}

function replayExpectedResult(value: unknown): ReplayExpectedResult | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.shouldResolve !== "boolean") return null;
  const optionalString = (field: string) => {
    const item = candidate[field];
    return item == null || typeof item === "string" ? item : undefined;
  };
  const price = candidate.price;
  if (price != null && typeof price !== "number") return null;
  return {
    shouldResolve: candidate.shouldResolve,
    title: optionalString("title") as string | null | undefined,
    productId: optionalString("productId") as string | null | undefined,
    variantId: optionalString("variantId") as string | null | undefined,
    price: price as number | null | undefined,
    currency: optionalString("currency") as string | null | undefined,
  };
}

export function prepareReplayFixture(
  failure: StoredExtractionFailure
): ExtractionReplayFixture | null {
  const expected = replayExpectedResult(failure.expectedResult);
  if (!expected || !failure.reducedContent) return null;
  return {
    id: failure.id,
    domain: failure.domain,
    platform: failure.platform,
    content: failure.reducedContent,
    pageUrl: failure.sourceUrl ?? undefined,
    expected,
    knownGood: expected.shouldResolve,
    failureReasons: failureReasons(failure),
  };
}

const SENSITIVE_KEY =
  /^(?:authorization|cookie|set-cookie|password|passwd|secret|client_secret|api_?key|access_?token|refresh_?token|session|sessionid|csrf|private_?key)$/i;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sanitizeSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeFailureDomain(
  domain: string,
  sourceUrl: string
): string {
  const candidate = domain.includes("://") ? domain : `https://${domain}`;
  try {
    return new URL(candidate).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    try {
      return new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "unknown";
    }
  }
}

export function sanitizeExtractionContent(
  content: string,
  maxChars = ENV.scraperFailureContentMaxChars
): string {
  return content
    .replace(
      /(\b(?:authorization|cookie|set-cookie)\s*:)\s*[^\r\n]+/gi,
      "$1 [REDACTED]"
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /(["']?(?:password|passwd|secret|client_secret|api_?key|access_?token|refresh_?token|session|csrf)["']?\s*[:=]\s*)["'][^"']*["']/gi,
      '$1"[REDACTED]"'
    )
    .replace(
      /([?&](?:token|key|secret|password|session|auth|code)=)[^&#\s"']+/gi,
      "$1[REDACTED]"
    )
    .replace(
      /(<input\b[^>]*(?:type=["']password["']|name=["'][^"']*(?:token|secret|password|session)[^"']*["'])[^>]*\bvalue=["'])[^"']*(["'])/gi,
      "$1[REDACTED]$2"
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .slice(0, maxChars);
}

export function sanitizeStructuredValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (typeof value === "string") return sanitizeExtractionContent(value, 2_000);
  if (value == null || typeof value === "number" || typeof value === "boolean")
    return value;
  if (Array.isArray(value))
    return value
      .slice(0, 100)
      .map(item => sanitizeStructuredValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, item]) => [
          key,
          SENSITIVE_KEY.test(key)
            ? "[REDACTED]"
            : sanitizeStructuredValue(item, depth + 1),
        ])
    );
  }
  return String(value);
}

export function fingerprintStorefront(content: string): PlatformFingerprint {
  const markerRules: Array<[string, RegExp]> = [
    ["shopify.theme", /\bShopify\.theme\b/i],
    ["shopify.section", /\bshopify-section\b/i],
    ["shopify.cdn", /cdn\.shopify\.com/i],
    ["shopify.routes", /\bShopify\.routes\b/i],
    ["woocommerce", /\bwoocommerce\b/i],
    ["woocommerce.ajax", /\bwc-ajax\b/i],
    ["woocommerce.plugin", /wp-content\/plugins\/woocommerce/i],
    ["magento.init", /\bx-magento-init\b/i],
    ["magento.catalog", /\bMagento_Catalog\b/i],
    ["magento.mage", /\bmage\/cookies\b/i],
    ["bigcommerce.stencil", /\bstencil-utils\b/i],
    ["bigcommerce.cdn", /cdn\d*\.bigcommerce\.com/i],
    ["bigcommerce.context", /\bBigCommerce\b/i],
    ["state.initial", /\b__INITIAL_STATE__\b/i],
    ["state.next", /\b__NEXT_DATA__\b/i],
    ["state.nuxt", /\b__NUXT__\b/i],
    ["state.product", /\b__PRODUCT_STATE__\b/i],
    ["state.productData", /\bproductData\b/i],
    ["state.selectedVariant", /\bselectedVariant(?:Id)?\b/i],
    ["schema.product", /["']@type["']\s*:\s*["']Product["']/i],
    ["dom.product-id", /\bdata-product-id\s*=/i],
    ["dom.price", /\bitemprop=["']price["']/i],
  ];
  const markers = markerRules
    .filter(([, pattern]) => pattern.test(content))
    .map(([name]) => name)
    .sort();
  const hasPrefix = (prefix: string) =>
    markers.some(marker => marker.startsWith(prefix));
  const platform: StorefrontPlatform = hasPrefix("shopify.")
    ? "shopify"
    : hasPrefix("woocommerce")
      ? "woocommerce"
      : hasPrefix("magento.")
        ? "magento"
        : hasPrefix("bigcommerce.")
          ? "bigcommerce"
          : hasPrefix("state.") || hasPrefix("dom.") || hasPrefix("schema.")
            ? "custom"
            : "unknown";
  return {
    platform,
    markers,
    markerFingerprint: hash(markers.join("|")),
  };
}

function unresolvedResolution(content: string): ExtractionResolution {
  const fingerprint = fingerprintStorefront(content);
  const failureReasons: ExtractionFailureReason[] = [
    "missing_product_identity",
    "missing_price",
    fingerprint.markers.some(marker => marker.startsWith("state."))
      ? "javascript_state_unrecognized"
      : "unsupported_page_structure",
  ];
  return {
    state: "unresolved",
    confidence: 0,
    score: 0,
    breakdown: [
      {
        signal: "deterministic_evidence",
        points: 0,
        reason: "no deterministic product candidate was resolved",
      },
    ],
    failureReasons,
  };
}

export function prepareFailureRecord(
  input: FailureRecordInput
): PreparedFailureRecord {
  const resolution =
    input.matchAssessment?.resolution ??
    input.deterministic?.resolution ??
    unresolvedResolution(input.pageContentForFingerprint);
  const fingerprint = fingerprintStorefront(input.pageContentForFingerprint);
  const domain = normalizeFailureDomain(input.domain, input.sourceUrl);
  const sourceUrl = sanitizeSourceUrl(input.sourceUrl);
  const failureKey = hash(
    [
      input.productId,
      input.competitorId ?? "none",
      sourceUrl ?? domain,
      input.contentHash,
      EXTRACTOR_VERSION,
    ].join("|")
  );
  return {
    failureKey,
    productId: input.productId,
    competitorId: input.competitorId ?? null,
    domain,
    sourceUrl,
    contentHash: input.contentHash,
    extractorVersion: EXTRACTOR_VERSION,
    resolutionState: resolution.state,
    failureReasons:
      resolution.failureReasons.length > 0
        ? resolution.failureReasons
        : ["unknown"],
    platform: fingerprint.platform,
    markerFingerprint: fingerprint.markerFingerprint,
    markers: fingerprint.markers,
    productEvidence: (input.deterministic?.productEvidence ?? []).map(item =>
      sanitizeStructuredValue(item)
    ) as ExtractionEvidence[],
    variantEvidence: (input.deterministic?.variantEvidence ?? []).map(item =>
      sanitizeStructuredValue(item)
    ) as ExtractionEvidence[],
    priceEvidence: (input.deterministic?.priceEvidence ?? []).map(item =>
      sanitizeStructuredValue(item)
    ) as ExtractionEvidence[],
    candidateCount: input.deterministic?.candidates.length ?? 0,
    confidence: resolution.confidence,
    scoreBreakdown: resolution.breakdown,
    reducedContent: sanitizeExtractionContent(input.reducedContent),
    deterministicDecision: sanitizeStructuredValue(
      input.deterministic
        ? {
            title: input.deterministic.title,
            price: input.deterministic.price,
            currency: input.deterministic.currency,
            salePrice: input.deterministic.salePrice,
            originalPrice: input.deterministic.originalPrice,
            productIdentity: input.deterministic.productIdentity,
            resolution: input.deterministic.resolution,
          }
        : { resolution }
    ),
    aiDecision: sanitizeStructuredValue(input.aiDecision),
  };
}

function failureReasons(record: StoredExtractionFailure) {
  return Array.isArray(record.failureReasons)
    ? (record.failureReasons.filter(
        reason => typeof reason === "string"
      ) as ExtractionFailureReason[])
    : (["unknown"] as ExtractionFailureReason[]);
}

function recordMarkers(record: StoredExtractionFailure): string[] {
  return Array.isArray(record.markers)
    ? record.markers.filter(marker => typeof marker === "string")
    : [];
}

export function clusterExtractionFailures(
  records: StoredExtractionFailure[],
  minimumOccurrences = ENV.scraperImprovementMinFailures
): FailureCluster[] {
  const groups = new Map<string, StoredExtractionFailure[]>();
  for (const record of records) {
    for (const reason of failureReasons(record)) {
      const rawKey = [
        record.domain,
        record.platform,
        reason,
        record.markerFingerprint,
      ].join("|");
      const existing = groups.get(rawKey) ?? [];
      existing.push(record);
      groups.set(rawKey, existing);
    }
  }
  return Array.from(groups.entries())
    .map(([rawKey, failures]) => {
      const affectedFailureCount = failures.reduce(
        (total, failure) => total + failure.occurrenceCount,
        0
      );
      const [domain, platform, failureReason, markerFingerprint] =
        rawKey.split("|");
      const representativeFailures = failures
        .slice()
        .sort(
          (left, right) =>
            Number(left.confidence ?? 0) - Number(right.confidence ?? 0)
        )
        .slice(0, 3);
      return {
        clusterKey: hash(rawKey),
        domain,
        platform: platform as StorefrontPlatform,
        failureReason: failureReason as ExtractionFailureReason,
        markerFingerprint,
        markers: recordMarkers(failures[0]),
        affectedFailureCount,
        failures,
        representativeFailures,
      };
    })
    .filter(cluster => cluster.affectedFailureCount >= minimumOccurrences)
    .sort(
      (left, right) => right.affectedFailureCount - left.affectedFailureCount
    );
}

export const extractionFailureIntelligenceService = {
  async recordFailure(input: FailureRecordInput) {
    const prepared = prepareFailureRecord(input);
    const database = await requireDb();
    const now = new Date();
    const [record] = await database
      .insert(extractionFailures)
      .values(prepared)
      .onConflictDoUpdate({
        target: extractionFailures.failureKey,
        set: {
          occurrenceCount: sql`${extractionFailures.occurrenceCount} + 1`,
          lastObservedAt: now,
          updatedAt: now,
          status: "pending",
          aiDecision: prepared.aiDecision,
          failureReasons: prepared.failureReasons,
          scoreBreakdown: prepared.scoreBreakdown,
        },
      })
      .returning();
    logger.info(
      {
        failureId: record.id,
        domain: record.domain,
        platform: record.platform,
        reasons: record.failureReasons,
        extractorVersion: record.extractorVersion,
      },
      "Structured extraction failure recorded"
    );
    return record;
  },

  async listPending(limit = 500) {
    const database = await requireDb();
    return database
      .select()
      .from(extractionFailures)
      .where(eq(extractionFailures.status, "pending"))
      .orderBy(desc(extractionFailures.lastObservedAt))
      .limit(Math.min(5_000, Math.max(1, limit)));
  },

  async markAnalyzed(ids: string[]) {
    if (ids.length === 0) return;
    const database = await requireDb();
    for (const id of ids) {
      await database
        .update(extractionFailures)
        .set({ status: "analyzed", updatedAt: new Date() })
        .where(eq(extractionFailures.id, id));
    }
  },

  async labelReplayFixture(
    failureId: string,
    expectedResult: ReplayExpectedResult
  ) {
    const validated = replayExpectedResult(expectedResult);
    if (!validated) throw new Error("Invalid replay fixture expected result");
    const database = await requireDb();
    const [record] = await database
      .update(extractionFailures)
      .set({
        expectedResult: validated,
        status: "fixture",
        updatedAt: new Date(),
      })
      .where(eq(extractionFailures.id, failureId))
      .returning();
    return record ?? null;
  },

  async listReplayFixtures(limit = 1_000) {
    const database = await requireDb();
    const records = await database
      .select()
      .from(extractionFailures)
      .where(isNotNull(extractionFailures.expectedResult))
      .orderBy(desc(extractionFailures.updatedAt))
      .limit(Math.min(10_000, Math.max(1, limit)));
    return records
      .map(prepareReplayFixture)
      .filter((fixture): fixture is ExtractionReplayFixture =>
        Boolean(fixture)
      );
  },
};
