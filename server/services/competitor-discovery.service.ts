import { and, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { requireDb } from "../_core/db-assert";
import {
  alerts,
  competitorDiscoveries,
  competitorDiscoveryLocks,
  competitorProducts,
  competitors,
  cronRuns,
  priceChanges,
  priceHistory,
  priceSnapshots,
  products,
  scrapeLogs,
  type CompetitorDiscovery,
} from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { ENV } from "../_core/env";
import { fetchAndExtractProduct } from "./price-radar/price-radar.service";
import { canonicalizeUrl } from "./price-radar/url-policy";
import { exaSearchService } from "./exa-search.service";
import { normalizeComparablePrice } from "./competitor-discovery.normalization";
import {
  buildDiscoveryQueries,
  decideDiscoveryMatch,
  type DiscoveryMatchType,
} from "./competitor-discovery.matcher";

export interface DiscoveryCandidate {
  url: string;
  domain: string;
  title: string;
  position: number;
  confidence: number;
}

export interface DiscoveryResult {
  productId: string;
  candidates: DiscoveryCandidate[];
  totalFound: number;
  newCandidates: number;
  validCompetitors: number;
  rejectedCandidates: number;
}

export interface SearchConfig {
  country: string;
  language: string;
  googleDomain: string;
  gl: string;
  hl: string;
}

interface ProviderSearchResult {
  candidates: DiscoveryCandidate[];
  error?: string;
}

const COUNTRY_CONFIG: Record<string, SearchConfig> = {
  US: { country: "US", language: "en", googleDomain: "google.com", gl: "us", hl: "en" },
  GB: { country: "GB", language: "en", googleDomain: "google.co.uk", gl: "uk", hl: "en" },
  DE: { country: "DE", language: "de", googleDomain: "google.de", gl: "de", hl: "de" },
  FR: { country: "FR", language: "fr", googleDomain: "google.fr", gl: "fr", hl: "fr" },
  CA: { country: "CA", language: "en", googleDomain: "google.ca", gl: "ca", hl: "en" },
  AU: { country: "AU", language: "en", googleDomain: "google.com.au", gl: "au", hl: "en" },
  JP: { country: "JP", language: "ja", googleDomain: "google.co.jp", gl: "jp", hl: "ja" },
  BR: { country: "BR", language: "pt", googleDomain: "google.com.br", gl: "br", hl: "pt" },
  IN: { country: "IN", language: "en", googleDomain: "google.co.in", gl: "in", hl: "en" },
  NL: { country: "NL", language: "nl", googleDomain: "google.nl", gl: "nl", hl: "nl" },
};

let lastSearchStartedAt = 0;

async function waitForSearchRateLimit(): Promise<void> {
  const minimumIntervalMs = 250;
  const waitMs = Math.max(0, minimumIntervalMs - (Date.now() - lastSearchStartedAt));
  if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
  lastSearchStartedAt = Date.now();
}

function getSearchConfig(country?: string, language?: string): SearchConfig {
  const config = COUNTRY_CONFIG[(country ?? "US").toUpperCase()] ?? COUNTRY_CONFIG.US;
  return language ? { ...config, language, hl: language } : config;
}

export function normalizeDiscoveryUrl(url: string): string {
  const canonical = canonicalizeUrl(url);
  return (canonical ?? url).toLowerCase().replace(/\/+$/, "");
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export async function searchWithExa(
  query: string,
  numResults = 10
): Promise<ProviderSearchResult> {
  const result = await exaSearchService.searchProductsDetailed(query, numResults);
  return {
    candidates: result.results.flatMap((item, index) => {
      if (!/^https?:\/\//i.test(item.url)) return [];
      return [{
        url: item.url,
        domain: extractDomain(item.url),
        title: item.title || item.snippet,
        position: index + 1,
        confidence: Math.max(0.35, 0.9 - index * 0.06),
      }];
    }),
    error: result.error,
  };
}

function candidateSearchScore(
  candidate: DiscoveryCandidate,
  productTitle: string,
  brand: string | null
): number {
  const words = productTitle
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 2);
  const title = candidate.title.toLowerCase();
  const overlap = words.filter(word => title.includes(word)).length / Math.max(words.length, 1);
  const brandSignal = brand && (title.includes(brand.toLowerCase()) || candidate.domain.includes(brand.toLowerCase())) ? 0.15 : 0;
  return Math.min(1, Math.round((candidate.confidence * 0.6 + overlap * 0.4 + brandSignal) * 100) / 100);
}

function availabilityFromExtraction(value: string): string {
  return value || "unknown";
}

export async function upsertDiscoveryAudit(
  database: Awaited<ReturnType<typeof requireDb>>,
  input: {
    userId: string;
    productId: string;
    searchQuery: string;
    searchEngine: string;
    country: string;
    language: string;
    candidate: DiscoveryCandidate;
  }
): Promise<{ id: string; isNew: boolean }> {
  const existing = await database
    .select({ candidateUrl: competitorDiscoveries.candidateUrl })
    .from(competitorDiscoveries)
    .where(
      and(
        eq(competitorDiscoveries.userId, input.userId),
        eq(competitorDiscoveries.productId, input.productId)
      )
    );
  const match = existing.find(row => normalizeDiscoveryUrl(row.candidateUrl) === normalizeDiscoveryUrl(input.candidate.url));
  const [inserted] = await database
    .insert(competitorDiscoveries)
    .values({
      userId: input.userId,
      productId: input.productId,
      searchQuery: input.searchQuery,
      searchEngine: input.searchEngine,
      country: input.country,
      language: input.language,
      candidateUrl: input.candidate.url,
      candidateDomain: input.candidate.domain,
      candidateTitle: input.candidate.title || null,
      searchPosition: input.candidate.position,
      confidence: input.candidate.confidence,
      status: "pending",
    })
    .returning({ id: competitorDiscoveries.id });
  return { id: inserted.id, isNew: !match };
}

async function updateDiscoveryAudit(
  database: Awaited<ReturnType<typeof requireDb>>,
  discoveryId: string,
  data: {
    status: string;
    checkedAt: Date;
    confidence?: number;
    extractedPrice?: string | null;
    extractedCurrency?: string | null;
    normalizedPrice?: string | null;
    normalizedCurrency?: string | null;
    normalizationMethod?: string | null;
    matchType?: DiscoveryMatchType | null;
    rejectionReason?: string | null;
    competitorProductId?: string | null;
  }
): Promise<void> {
  await database
    .update(competitorDiscoveries)
    .set(data)
    .where(eq(competitorDiscoveries.id, discoveryId));
}

async function recordDiscoveryScrapeLog(
  database: Awaited<ReturnType<typeof requireDb>>,
  input: {
    cronRunId: string;
    url: string;
    status: string;
    method?: string;
    httpStatus?: number;
    responseTimeMs?: number;
    htmlSize?: number;
    retryCount?: number;
    errorMessage?: string;
  }
): Promise<void> {
  try {
    await database.insert(scrapeLogs).values(input);
  } catch (error) {
    logger.debug({ url: input.url, error }, "Could not record discovery scrape log");
  }
}

const DISCOVERY_LEASE_MS = 15 * 60 * 1000;

export async function acquireDiscoveryLease(
  database: Awaited<ReturnType<typeof requireDb>>,
  userId: string,
  productId: string
): Promise<string> {
  const ownerToken = randomUUID();
  const leaseUntil = new Date(Date.now() + DISCOVERY_LEASE_MS);
  const [lease] = await database
    .insert(competitorDiscoveryLocks)
    .values({ userId, productId, ownerToken, leaseUntil })
    .onConflictDoUpdate({
      target: [competitorDiscoveryLocks.userId, competitorDiscoveryLocks.productId],
      set: { ownerToken, leaseUntil, createdAt: new Date() },
      where: sql`${competitorDiscoveryLocks.leaseUntil} < now()`,
    })
    .returning({ ownerToken: competitorDiscoveryLocks.ownerToken });
  if (!lease) throw new Error("A competitor discovery run is already active for this product");
  return lease.ownerToken;
}

export async function releaseDiscoveryLease(
  database: Awaited<ReturnType<typeof requireDb>>,
  userId: string,
  productId: string,
  ownerToken: string
): Promise<void> {
  await database
    .delete(competitorDiscoveryLocks)
    .where(
      and(
        eq(competitorDiscoveryLocks.userId, userId),
        eq(competitorDiscoveryLocks.productId, productId),
        eq(competitorDiscoveryLocks.ownerToken, ownerToken)
      )
    );
}

export const competitorDiscoveryService = {
  async discoverForProduct(
    userId: string,
    productId: string,
    options?: { country?: string; language?: string; maxResults?: number }
  ): Promise<DiscoveryResult> {
    const database = await requireDb();
    const [product] = await database
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.userId, userId), eq(products.isActive, true)))
      .limit(1);
    if (!product) throw new Error("Product not found");

    const leaseToken = await acquireDiscoveryLease(database, userId, productId);

    let cronRun: { id: string };
    try {
      [cronRun] = await database
        .insert(cronRuns)
        .values({
          jobType: "competitor_discovery",
          status: "running",
          metadata: { userId, productId },
        })
        .returning({ id: cronRuns.id });
    } catch (error) {
      await releaseDiscoveryLease(database, userId, productId, leaseToken);
      throw error;
    }

    try {
      const config = getSearchConfig(options?.country, options?.language);
    const queries = buildDiscoveryQueries({
      title: product.title,
      brand: product.vendor,
      manufacturer: product.vendor,
      description: product.description,
      productType: product.productType,
      tags: product.tags ? product.tags.split(",").map(tag => tag.trim()).filter(Boolean) : [],
      sku: product.sku,
      barcode: product.barcode,
      gtin: product.gtin,
      mpn: product.mpn,
      modelNumber: product.modelNumber,
    });
    const candidates: DiscoveryCandidate[] = [];
    const seen = new Set<string>();
    const providerFailures: Array<{
      provider: string;
      query: string;
      error: string;
      occurredAt: string;
    }> = [];

    const providerAvailability = [["exa", Boolean(ENV.exaApiKey)]] as const;
    const activeSearchProviders = providerAvailability
      .filter(([, configured]) => configured)
      .map(([provider]) => provider);
    for (const [provider, configured] of providerAvailability) {
      if (!configured) {
        providerFailures.push({
          provider,
          query: "",
          error: "provider-not-configured",
          occurredAt: new Date().toISOString(),
        });
      }
    }
    for (const query of queries) {
      await waitForSearchRateLimit();
      const providerResults = await Promise.all([
        ENV.exaApiKey
          ? searchWithExa(query, 10).then(result => ["exa", result] as const)
          : Promise.resolve(["exa", { candidates: [], error: "provider-not-configured" }] as const),
      ]);
      for (const [provider, result] of providerResults) {
        if (result.error && result.error !== "provider-not-configured") {
          providerFailures.push({
            provider,
            query,
            error: result.error,
            occurredAt: new Date().toISOString(),
          });
        }
        for (const candidate of result.candidates) {
        const normalized = normalizeDiscoveryUrl(candidate.url);
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        candidate.confidence = candidateSearchScore(candidate, product.title, product.vendor);
        candidates.push(candidate);
        }
      }
    }

    candidates.sort((left, right) => right.confidence - left.confidence);
    const filtered = candidates.slice(0, options?.maxResults ?? 50);
    let newCandidates = 0;
    let validCompetitors = 0;
    let rejectedCandidates = 0;

    for (const candidate of filtered) {
      let audit: { id: string; isNew: boolean };
      try {
        audit = await upsertDiscoveryAudit(database, {
          userId,
          productId,
          searchQuery: queries.join(" | "),
          searchEngine: activeSearchProviders.join(",") || "none",
          country: config.country,
          language: config.language,
          candidate,
        });
        if (audit.isNew) newCandidates++;
      } catch (error) {
        logger.warn({ productId, url: candidate.url, error }, "Could not record discovery candidate");
        continue;
      }

      try {
        const { page, extraction } = await fetchAndExtractProduct(candidate.url);
        await recordDiscoveryScrapeLog(database, {
          cronRunId: cronRun.id,
          url: candidate.url,
          status: extraction.product ? "success" : "empty",
          method: page.renderMode,
          httpStatus: page.statusCode,
          responseTimeMs: page.responseTimeMs,
          htmlSize: Buffer.byteLength(page.html, "utf8"),
          retryCount: page.retryCount,
        });
        const extracted = extraction.product;
        if (!extracted) {
          rejectedCandidates++;
          await updateDiscoveryAudit(database, audit.id, {
            status: "rejected",
            checkedAt: new Date(),
            rejectionReason: extraction.warnings.join("; ") || "No product data extracted",
          });
          continue;
        }

        const decision = decideDiscoveryMatch(
          {
            title: product.title,
            brand: product.vendor,
            manufacturer: product.vendor,
            description: product.description,
            productType: product.productType,
            tags: product.tags ? product.tags.split(",").map(tag => tag.trim()).filter(Boolean) : [],
            sku: product.sku,
            barcode: product.barcode,
            gtin: product.gtin,
            mpn: product.mpn,
            modelNumber: product.modelNumber,
            category: product.category,
          },
          {
            title: extracted.name,
            brand: extracted.brand,
            sku: extracted.sku,
            barcode: extracted.barcode,
            gtin: extracted.gtin,
            mpn: extracted.mpn,
            modelNumber: extracted.modelNumber,
            category: extracted.category,
            attributes: extracted.attributes,
            productUrl: extracted.productUrl,
            price: extracted.price,
            currency: extracted.currency,
            availability: extracted.availability,
            condition: extracted.condition,
            variant: extracted.variant,
            quantity: extracted.quantity,
            unit: extracted.unit,
          }
        );
        const checkedAt = new Date();
        const normalized = normalizeComparablePrice({
          price: extracted.price,
          currency: extracted.currency,
          quantity: extracted.quantity,
        });
        if (!decision.accepted || !extracted.price || !extracted.currency) {
          rejectedCandidates++;
          await updateDiscoveryAudit(database, audit.id, {
            status: "rejected",
            checkedAt,
            extractedPrice: extracted.price,
            extractedCurrency: extracted.currency?.slice(0, 3).toUpperCase(),
            normalizedPrice: normalized.price,
            normalizedCurrency: normalized.currency,
            normalizationMethod: normalized.method,
            confidence: decision.score,
            matchType: decision.matchType,
            rejectionReason: decision.reason ?? "Offer did not meet validation requirements",
          });
          continue;
        }
        const verifiedPrice = extracted.price;
        const verifiedCurrency = extracted.currency.slice(0, 3).toUpperCase();

        const link = await database.transaction(async tx => {
          const domain = extractDomain(extracted.productUrl || candidate.url);
          const lockKey = `${userId}:${domain}`;
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
          const [existingCompetitor] = await tx
            .select()
            .from(competitors)
            .where(
              and(
                eq(competitors.userId, userId),
                sql`regexp_replace(lower(${competitors.domain}), '^www\\.', '') = ${domain}`
              )
            )
            .limit(1);
          const [competitor] = existingCompetitor
            ? await tx
                .update(competitors)
                .set({
                  normalizedName: domain,
                  logoUrl: existingCompetitor.logoUrl ?? extracted.images[0] ?? null,
                  lastScrapedAt: checkedAt,
                  scrapeStatus: "success",
                  scrapeError: null,
                  updatedAt: checkedAt,
                })
                .where(eq(competitors.id, existingCompetitor.id))
                .returning()
            : await tx
                .insert(competitors)
                .values({
                  userId,
                  name: extracted.seller ?? domain,
                  normalizedName: domain,
                  domain,
                  logoUrl: extracted.images[0] ?? null,
                  status: "active",
                  productsTracked: 0,
                  scrapeStatus: "success",
                  lastScrapedAt: checkedAt,
                })
                .returning();
          if (!competitor) throw new Error("Competitor could not be persisted");

          const [existingLink] = await tx
            .select()
            .from(competitorProducts)
            .where(
              and(
                eq(competitorProducts.competitorId, competitor.id),
                eq(competitorProducts.productId, productId)
              )
            )
            .limit(1);
          const oldPrice = existingLink?.price ?? null;
          const changed = oldPrice !== null && oldPrice !== verifiedPrice;
          const [savedLink] = await tx
            .insert(competitorProducts)
            .values({
              competitorId: competitor.id,
              productId,
              competitorProductUrl: extracted.productUrl,
              competitorProductTitle: extracted.name,
              competitorSku:
                extracted.sku ??
                extracted.barcode ??
                extracted.gtin ??
                extracted.mpn ??
                extracted.modelNumber,
              price: verifiedPrice,
              basePrice: extracted.basePrice,
              currency: verifiedCurrency,
              normalizedPrice: normalized.price,
              normalizedCurrency: normalized.currency,
              normalizationMethod: normalized.method,
              imageUrl: extracted.images[0] ?? null,
              availability: availabilityFromExtraction(extracted.availability),
              salePrice: extracted.salePrice,
              originalPrice: extracted.previousPrice,
              couponAmount: extracted.couponAmount,
              couponCode: extracted.couponCode,
              membershipPrice: extracted.membershipPrice,
              priceType: extracted.priceType,
              shippingPrice: extracted.shippingPrice,
              taxAmount: extracted.taxAmount,
              discountAmount: extracted.discountAmount,
              condition: extracted.condition,
              quantity: extracted.quantity?.toString() ?? null,
              unit: extracted.unit,
              variant: extracted.variant,
              metadata: extracted.structuredMetadata,
              matchType: decision.matchType,
              matchScore: decision.score,
              matchMethod: decision.method,
              sourceType: "automatic-discovery",
              sourceProductId: audit.id,
              isVerified: true,
              isActive: true,
              previousPrice: changed ? oldPrice : existingLink?.previousPrice ?? null,
              lastPriceUpdate: checkedAt,
              lastScrapedAt: checkedAt,
              updatedAt: checkedAt,
            })
            .onConflictDoUpdate({
              target: [competitorProducts.competitorId, competitorProducts.productId],
              set: {
                competitorProductUrl: sql`excluded.competitor_product_url`,
                competitorProductTitle: sql`excluded.competitor_product_title`,
                competitorSku: sql`excluded.competitor_sku`,
                price: sql`excluded.price`,
                basePrice: sql`excluded.base_price`,
                currency: sql`excluded.currency`,
                normalizedPrice: sql`excluded.normalized_price`,
                normalizedCurrency: sql`excluded.normalized_currency`,
                normalizationMethod: sql`excluded.normalization_method`,
                imageUrl: sql`excluded.image_url`,
                availability: sql`excluded.availability`,
                salePrice: sql`excluded.sale_price`,
                originalPrice: sql`excluded.original_price`,
                couponAmount: sql`excluded.coupon_amount`,
                couponCode: sql`excluded.coupon_code`,
                membershipPrice: sql`excluded.membership_price`,
                priceType: sql`excluded.price_type`,
                shippingPrice: sql`excluded.shipping_price`,
                taxAmount: sql`excluded.tax_amount`,
                discountAmount: sql`excluded.discount_amount`,
                condition: sql`excluded.condition`,
                quantity: sql`excluded.quantity`,
                unit: sql`excluded.unit`,
                variant: sql`excluded.variant`,
                metadata: sql`excluded.metadata`,
                matchType: sql`excluded.match_type`,
                matchScore: sql`excluded.match_score`,
                matchMethod: sql`excluded.match_method`,
                sourceType: sql`excluded.source_type`,
                sourceProductId: sql`excluded.source_product_id`,
                isVerified: true,
                isActive: true,
                previousPrice: changed ? oldPrice : existingLink?.previousPrice ?? null,
                lastPriceUpdate: checkedAt,
                lastScrapedAt: checkedAt,
                updatedAt: checkedAt,
              },
            })
            .returning();
          if (!savedLink) throw new Error("Competitor product could not be persisted");

          await tx.insert(priceSnapshots).values({
            competitorProductId: savedLink.id,
            price: verifiedPrice,
            basePrice: extracted.basePrice,
            currency: verifiedCurrency,
            salePrice: extracted.salePrice,
            originalPrice: extracted.previousPrice,
            couponAmount: extracted.couponAmount,
            couponCode: extracted.couponCode,
            membershipPrice: extracted.membershipPrice,
            priceType: extracted.priceType,
            availability: extracted.availability,
            scrapeMethod: extracted.extractionMethod.slice(0, 32),
            scrapedAt: checkedAt,
          });
          await tx.insert(priceHistory).values({
            productId,
            competitorProductId: savedLink.id,
            price: verifiedPrice,
            currency: verifiedCurrency,
            source: "competitor-discovery",
            recordedAt: checkedAt,
          });
          if (changed && oldPrice) {
            const difference = Number(verifiedPrice) - Number(oldPrice);
            await tx.insert(priceChanges).values({
              competitorProductId: savedLink.id,
              productId,
              changeType: difference < 0 ? "price_decrease" : "price_increase",
              previousPrice: oldPrice,
              newPrice: verifiedPrice,
              previousAvailability: existingLink?.availability ?? "unknown",
              newAvailability: extracted.availability,
              priceDiff: difference.toFixed(2),
              priceDiffPercent: Number(oldPrice) > 0 ? ((difference / Number(oldPrice)) * 100).toFixed(2) : null,
              currency: verifiedCurrency,
              detectedAt: checkedAt,
            });
          }
          const [{ count }] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(competitorProducts)
            .where(and(eq(competitorProducts.competitorId, competitor.id), eq(competitorProducts.isActive, true)));
          await tx
            .update(competitors)
            .set({ productsTracked: count, updatedAt: checkedAt })
            .where(eq(competitors.id, competitor.id));
          await tx
            .update(competitorDiscoveries)
            .set({
              status: "imported",
              extractedPrice: extracted.price,
              extractedCurrency: verifiedCurrency,
              normalizedPrice: normalized.price,
              normalizedCurrency: normalized.currency,
              normalizationMethod: normalized.method,
              confidence: decision.score,
              matchType: decision.matchType,
              rejectionReason: null,
              competitorProductId: savedLink.id,
              checkedAt,
            })
            .where(eq(competitorDiscoveries.id, audit.id));
          return savedLink.id;
        });
        if (link) validCompetitors++;
      } catch (error) {
        rejectedCandidates++;
        logger.warn({ productId, url: candidate.url, error }, "Candidate validation failed");
        await recordDiscoveryScrapeLog(database, {
          cronRunId: cronRun.id,
          url: candidate.url,
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Candidate could not be fetched",
        });
        await updateDiscoveryAudit(database, audit.id, {
          status: "rejected",
          checkedAt: new Date(),
          rejectionReason: error instanceof Error ? error.message : "Candidate could not be validated",
        });
      }
    }

    if (newCandidates > 0) {
      try {
        await database.insert(alerts).values({
          userId,
          productId,
          alertType: "competitor_change",
          severity: "low",
          title: "Competitor discovery completed",
          message: `Found ${validCompetitors} verified competitor offer${validCompetitors === 1 ? "" : "s"} for "${product.title}".`,
        });
      } catch (error) {
        logger.debug({ productId, error }, "Could not create discovery alert");
      }
    }

    const runErrors = rejectedCandidates + providerFailures.length;
    const runDetails = providerFailures.length > 0 ? { providerFailures } : null;
    await database
      .update(cronRuns)
      .set({
        status: runErrors > 0 ? "partial" : "completed",
        completedAt: new Date(),
        productsProcessed: 1,
        productsUpdated: validCompetitors,
        errorsCount: runErrors,
        errorDetails: runDetails,
        metadata: { userId, productId, totalFound: candidates.length, providerFailures },
      })
      .where(eq(cronRuns.id, cronRun.id));

    logger.info(
      { productId, totalFound: candidates.length, newCandidates, validCompetitors, rejectedCandidates },
      "Competitor discovery completed"
    );
      return {
        productId,
        candidates: filtered,
        totalFound: candidates.length,
        newCandidates,
        validCompetitors,
        rejectedCandidates,
      };
    } catch (error) {
      await database
        .update(cronRuns)
        .set({
          status: "failed",
          completedAt: new Date(),
          errorsCount: 1,
          errorDetails: {
            userId,
            productId,
            message: error instanceof Error ? error.message : "Discovery failed",
          },
        })
        .where(eq(cronRuns.id, cronRun.id));
      throw error;
    } finally {
      await releaseDiscoveryLease(database, userId, productId, leaseToken);
    }
  },

  async discoverForAllProducts(
    userId: string,
    options?: { country?: string; language?: string }
  ): Promise<DiscoveryResult[]> {
    const database = await requireDb();
    const userProducts = await database
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.userId, userId), eq(products.isActive, true)));
    const results: DiscoveryResult[] = [];
    for (const product of userProducts) {
      try {
        results.push(await this.discoverForProduct(userId, product.id, options));
      } catch (error) {
        logger.warn({ productId: product.id, error }, "Discovery failed for product");
      }
    }
    return results;
  },

  async getDiscoveries(
    userId: string,
    options?: {
      productId?: string;
      status?: string;
      minConfidence?: number;
      limit?: number;
      offset?: number;
    }
  ): Promise<CompetitorDiscovery[]> {
    const database = await requireDb();
    const conditions = [eq(competitorDiscoveries.userId, userId)];
    if (options?.productId) conditions.push(eq(competitorDiscoveries.productId, options.productId));
    if (options?.status) conditions.push(eq(competitorDiscoveries.status, options.status));
    if (options?.minConfidence !== undefined) {
      conditions.push(sql`${competitorDiscoveries.confidence} >= ${options.minConfidence}`);
    }
    return database
      .select()
      .from(competitorDiscoveries)
      .where(and(...conditions))
      .orderBy(desc(competitorDiscoveries.checkedAt), desc(competitorDiscoveries.confidence))
      .limit(Math.min(options?.limit ?? 50, 200))
      .offset(options?.offset ?? 0);
  },

  async approveDiscovery(userId: string, discoveryId: string): Promise<CompetitorDiscovery | undefined> {
    const database = await requireDb();
    const [result] = await database
      .update(competitorDiscoveries)
      .set({ status: "verified" })
      .where(and(eq(competitorDiscoveries.id, discoveryId), eq(competitorDiscoveries.userId, userId)))
      .returning();
    return result;
  },

  async rejectDiscovery(userId: string, discoveryId: string): Promise<CompetitorDiscovery | undefined> {
    const database = await requireDb();
    const [result] = await database
      .update(competitorDiscoveries)
      .set({ status: "rejected", rejectionReason: "Rejected by merchant", checkedAt: new Date() })
      .where(and(eq(competitorDiscoveries.id, discoveryId), eq(competitorDiscoveries.userId, userId)))
      .returning();
    return result;
  },

  async getStats(userId: string) {
    const database = await requireDb();
    const result = await database
      .select({
        status: competitorDiscoveries.status,
        count: sql<number>`count(*)::int`,
        avgConfidence: sql<number>`coalesce(avg(${competitorDiscoveries.confidence}), 0)`,
      })
      .from(competitorDiscoveries)
      .where(eq(competitorDiscoveries.userId, userId))
      .groupBy(competitorDiscoveries.status);
    const stats = { total: 0, pending: 0, verified: 0, rejected: 0, imported: 0, avgConfidence: 0 };
    for (const row of result) {
      stats.total += row.count;
      if (row.status === "pending") stats.pending = row.count;
      if (row.status === "verified") stats.verified = row.count;
      if (row.status === "rejected") stats.rejected = row.count;
      if (row.status === "imported") stats.imported = row.count;
      stats.avgConfidence = Math.max(stats.avgConfidence, row.avgConfidence);
    }
    return stats;
  },

  async getRuns(userId: string, limit = 20) {
    const database = await requireDb();
    return database
      .select()
      .from(cronRuns)
      .where(
        and(
          eq(cronRuns.jobType, "competitor_discovery"),
          sql`${cronRuns.metadata}->>'userId' = ${userId}`
        )
      )
      .orderBy(desc(cronRuns.startedAt))
      .limit(Math.min(Math.max(limit, 1), 100));
  },
};
