import { eq, and, desc, sql } from "drizzle-orm";
import { Firecrawl } from "firecrawl";
import { requireDb } from "../_core/db-assert";
import {
  competitorDiscoveries,
  competitors,
  products,
  alerts,
  type CompetitorDiscovery,
  type InsertCompetitorDiscovery,
} from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { ENV } from "../_core/env";

// ─── Types ───────────────────────────────────────────────────────────────────

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
}

// ─── Country/Language Search Configuration ───────────────────────────────────

interface SearchConfig {
  country: string;
  language: string;
  googleDomain: string;
  gl: string;
  hl: string;
}

const COUNTRY_CONFIG: Record<string, SearchConfig> = {
  US: {
    country: "US",
    language: "en",
    googleDomain: "google.com",
    gl: "us",
    hl: "en",
  },
  GB: {
    country: "GB",
    language: "en",
    googleDomain: "google.co.uk",
    gl: "uk",
    hl: "en",
  },
  DE: {
    country: "DE",
    language: "de",
    googleDomain: "google.de",
    gl: "de",
    hl: "de",
  },
  FR: {
    country: "FR",
    language: "fr",
    googleDomain: "google.fr",
    gl: "fr",
    hl: "fr",
  },
  CA: {
    country: "CA",
    language: "en",
    googleDomain: "google.ca",
    gl: "ca",
    hl: "en",
  },
  AU: {
    country: "AU",
    language: "en",
    googleDomain: "google.com.au",
    gl: "au",
    hl: "en",
  },
  JP: {
    country: "JP",
    language: "ja",
    googleDomain: "google.co.jp",
    gl: "jp",
    hl: "ja",
  },
  BR: {
    country: "BR",
    language: "pt",
    googleDomain: "google.com.br",
    gl: "br",
    hl: "pt",
  },
  IN: {
    country: "IN",
    language: "en",
    googleDomain: "google.co.in",
    gl: "in",
    hl: "en",
  },
  NL: {
    country: "NL",
    language: "nl",
    googleDomain: "google.nl",
    gl: "nl",
    hl: "nl",
  },
};

function getSearchConfig(country?: string, language?: string): SearchConfig {
  const upper = (country ?? "US").toUpperCase();
  const config = COUNTRY_CONFIG[upper] ?? COUNTRY_CONFIG.US;
  if (language) {
    return { ...config, language, hl: language };
  }
  return config;
}

// ─── URL Helpers ─────────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const p of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ref",
      "referrer",
    ]) {
      u.searchParams.delete(p);
    }
    return u.toString().replace(/\/+$/, "").toLowerCase();
  } catch {
    return url.toLowerCase().replace(/\/+$/, "");
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ─── Search Query Builder ────────────────────────────────────────────────────

function buildSearchQueries(product: {
  title: string;
  brand?: string | null;
  sku?: string | null;
}): string[] {
  const queries: string[] = [];
  const title = product.title.trim();
  const brand = product.brand?.trim();
  const sku = product.sku?.trim();

  queries.push(title);

  if (brand && !title.toLowerCase().startsWith(brand.toLowerCase())) {
    queries.push(`${brand} ${title}`);
  }

  if (sku) {
    queries.push(`"${sku}"`);
  }

  const shortTitle = title.split(/\s+/).slice(0, 5).join(" ");
  if (shortTitle !== title && shortTitle.length > 10) {
    queries.push(shortTitle);
  }

  return Array.from(new Set(queries));
}

// ─── Firecrawl Search ────────────────────────────────────────────────────────

async function searchWithFirecrawl(
  query: string,
  numResults: number = 10
): Promise<DiscoveryCandidate[]> {
  if (!ENV.firecrawlApiKey) return [];

  try {
    const app = new Firecrawl({
      apiKey: ENV.firecrawlApiKey,
      apiUrl: ENV.firecrawlBaseUrl,
    });

    const result = await app.search(query, {
      limit: numResults,
      scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
    });

    const candidates: DiscoveryCandidate[] = [];
    const searchData = (
      result as unknown as {
        data?: Array<{
          url?: string;
          title?: string;
          metadata?: { url?: string };
        }>;
      }
    ).data;
    if (searchData) {
      for (let i = 0; i < searchData.length; i++) {
        const item = searchData[i];
        const url = item.url ?? item.metadata?.url ?? "";
        const title = item.title ?? "";
        if (!url || !url.startsWith("http")) continue;
        candidates.push({
          url,
          domain: extractDomain(url),
          title,
          position: i + 1,
          confidence: Math.max(0.3, 1 - i * 0.07),
        });
      }
    }
    return candidates;
  } catch (err) {
    logger.warn({ query, err }, "Firecrawl search failed");
    return [];
  }
}

// ─── SerpAPI Search ──────────────────────────────────────────────────────────

async function searchWithSerpApi(
  query: string,
  config: SearchConfig,
  numResults: number = 10
): Promise<DiscoveryCandidate[]> {
  if (!ENV.serpApiKey) return [];

  try {
    const params = new URLSearchParams({
      api_key: ENV.serpApiKey,
      q: query,
      engine: "google",
      num: String(numResults),
      gl: config.gl,
      hl: config.hl,
      domain: config.googleDomain,
    });

    const response = await fetch(`https://serpapi.com/search?${params}`, {
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, "SerpAPI search failed");
      return [];
    }

    const data = await response.json();
    const candidates: DiscoveryCandidate[] = [];

    const organic = (data.organic_results ?? []) as Array<{
      link?: string;
      title?: string;
      position?: number;
    }>;
    for (const item of organic) {
      if (!item.link) continue;
      candidates.push({
        url: item.link,
        domain: extractDomain(item.link),
        title: item.title ?? "",
        position: item.position ?? candidates.length + 1,
        confidence: Math.max(0.3, 1 - (item.position ?? 1) * 0.07),
      });
    }

    const shopping = (data.shopping_results ?? []) as Array<{
      link?: string;
      title?: string;
      position?: number;
    }>;
    for (const item of shopping) {
      if (!item.link) continue;
      candidates.push({
        url: item.link,
        domain: extractDomain(item.link),
        title: item.title ?? "",
        position: item.position ?? candidates.length + 1,
        confidence: Math.min(1.0, 0.82),
      });
    }

    return candidates;
  } catch (err) {
    logger.warn({ query, err }, "SerpAPI search failed");
    return [];
  }
}

// ─── Confidence Scoring ──────────────────────────────────────────────────────

function scoreCandidate(
  candidate: DiscoveryCandidate,
  product: { title: string; brand?: string | null; sku?: string | null },
  knownDomains: Set<string>
): number {
  let score = candidate.confidence;

  if (knownDomains.has(candidate.domain)) {
    score *= 0.3;
  }

  const productWords = product.title
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2);
  const candidateTitle = candidate.title.toLowerCase();
  const matchedWords = productWords.filter(w => candidateTitle.includes(w));
  const titleOverlap = matchedWords.length / Math.max(productWords.length, 1);
  score = score * 0.6 + titleOverlap * 0.4;

  if (product.brand) {
    const brandLower = product.brand.toLowerCase();
    if (
      candidateTitle.includes(brandLower) ||
      candidate.domain.includes(brandLower)
    ) {
      score = Math.min(1.0, score + 0.15);
    }
  }

  return Math.round(score * 100) / 100;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const competitorDiscoveryService = {
  async discoverForProduct(
    userId: string,
    productId: string,
    options?: { country?: string; language?: string; maxResults?: number }
  ): Promise<DiscoveryResult> {
    const database: any = await requireDb();

    const product = await database.query.products.findFirst({
      where: and(eq(products.id, productId), eq(products.userId, userId)),
    });
    if (!product) throw new Error("Product not found");

    const config = getSearchConfig(options?.country, options?.language);
    const queries = buildSearchQueries({
      title: product.title,
      brand: product.vendor,
      sku: product.sku,
    });

    const existingCompetitors = await database
      .select({ domain: competitors.domain })
      .from(competitors)
      .where(eq(competitors.userId, userId));
    const knownDomains = new Set<string>(
      existingCompetitors.map((c: any) => (c.domain as string).toLowerCase())
    );

    const existingDiscoveries = await database
      .select({ url: competitorDiscoveries.candidateUrl })
      .from(competitorDiscoveries)
      .where(eq(competitorDiscoveries.productId, productId));
    const seenUrls = new Set<string>(
      existingDiscoveries.map((d: any) => normalizeUrl(d.url as string))
    );

    const allCandidates: DiscoveryCandidate[] = [];
    const seenCandidates = new Set<string>();

    for (const query of queries) {
      let candidates: DiscoveryCandidate[] = [];
      if (ENV.serpApiKey) {
        candidates = await searchWithSerpApi(query, config, 10);
      }
      if (candidates.length === 0 && ENV.firecrawlApiKey) {
        candidates = await searchWithFirecrawl(query, 10);
      }

      for (let ci = 0; ci < candidates.length; ci++) {
        const candidate = candidates[ci];
        const normalized = normalizeUrl(candidate.url);
        if (seenCandidates.has(normalized)) continue;
        seenCandidates.add(normalized);

        candidate.confidence = scoreCandidate(
          candidate,
          {
            title: product.title,
            brand: product.vendor,
            sku: product.sku,
          },
          knownDomains
        );

        allCandidates.push(candidate);
      }
    }

    allCandidates.sort((a, b) => b.confidence - a.confidence);

    const maxResults = options?.maxResults ?? 50;
    const filtered = allCandidates
      .filter(c => {
        const normalized = normalizeUrl(c.url);
        return !seenUrls.has(normalized) && c.confidence >= 0.3;
      })
      .slice(0, maxResults);

    let newCount = 0;
    for (let fi = 0; fi < filtered.length; fi++) {
      const candidate = filtered[fi];
      try {
        await database.insert(competitorDiscoveries).values({
          userId,
          productId,
          searchQuery: queries.join(" | "),
          searchEngine: ENV.serpApiKey ? "serpapi" : "firecrawl",
          country: config.country,
          language: config.language,
          candidateUrl: candidate.url,
          candidateDomain: candidate.domain,
          candidateTitle: candidate.title,
          searchPosition: candidate.position,
          confidence: String(candidate.confidence),
          status: "pending",
        } as any);
        newCount++;
      } catch (err) {
        logger.debug(
          { url: candidate.url, err },
          "Skipping duplicate discovery"
        );
      }
    }

    // G3 — Create competitor_change alert if new candidates found
    if (newCount > 0) {
      try {
        await database.insert(alerts).values({
          userId,
          productId,
          alertType: "competitor_change",
          severity: "low",
          title: "New Competitors Discovered",
          message: `Found ${newCount} potential competitor${newCount > 1 ? "s" : ""} for "${product.title}". Review and add them to tracking.`,
        });
      } catch {
        // non-critical
      }
    }

    logger.info(
      { productId, totalFound: allCandidates.length, newCandidates: newCount },
      "Competitor discovery completed"
    );

    return {
      productId,
      candidates: filtered,
      totalFound: allCandidates.length,
      newCandidates: newCount,
    };
  },

  async discoverForAllProducts(
    userId: string,
    options?: { country?: string; language?: string }
  ): Promise<DiscoveryResult[]> {
    const database = await requireDb();
    const userProducts = await database
      .select()
      .from(products)
      .where(
        and(
          eq(products.userId, userId),
          eq(products.isActive, true),
          eq(products.isTracked, true)
        )
      );

    const results: DiscoveryResult[] = [];
    for (const product of userProducts) {
      try {
        const result = await this.discoverForProduct(
          userId,
          product.id,
          options
        );
        results.push(result);
      } catch (err) {
        logger.warn(
          { productId: product.id, err },
          "Discovery failed for product"
        );
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

    if (options?.productId)
      conditions.push(eq(competitorDiscoveries.productId, options.productId));
    if (options?.status)
      conditions.push(eq(competitorDiscoveries.status, options.status));
    if (options?.minConfidence !== undefined) {
      conditions.push(
        sql`${competitorDiscoveries.confidence} >= ${options.minConfidence}`
      );
    }

    return database
      .select()
      .from(competitorDiscoveries)
      .where(and(...conditions))
      .orderBy(desc(competitorDiscoveries.confidence))
      .limit(Math.min(options?.limit ?? 50, 200))
      .offset(options?.offset ?? 0);
  },

  async approveDiscovery(
    userId: string,
    discoveryId: string
  ): Promise<CompetitorDiscovery | undefined> {
    const database = await requireDb();
    const result = await database
      .update(competitorDiscoveries)
      .set({ status: "verified" })
      .where(
        and(
          eq(competitorDiscoveries.id, discoveryId),
          eq(competitorDiscoveries.userId, userId)
        )
      )
      .returning();
    return result[0];
  },

  async rejectDiscovery(
    userId: string,
    discoveryId: string
  ): Promise<CompetitorDiscovery | undefined> {
    const database = await requireDb();
    const result = await database
      .update(competitorDiscoveries)
      .set({ status: "rejected" })
      .where(
        and(
          eq(competitorDiscoveries.id, discoveryId),
          eq(competitorDiscoveries.userId, userId)
        )
      )
      .returning();
    return result[0];
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

    const stats = {
      total: 0,
      pending: 0,
      verified: 0,
      rejected: 0,
      imported: 0,
      avgConfidence: 0,
    };
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
};
