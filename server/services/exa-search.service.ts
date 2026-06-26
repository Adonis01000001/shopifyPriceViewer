import Exa from "exa-js";
import { logger } from "../_core/logger";
import { ENV } from "../_core/env";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExaSearchResult {
  url: string;
  title: string;
  snippet: string;
  /** Query-relevant highlights from the page */
  highlights: string[];
  /** Published date if available */
  publishedDate: string | null;
}

export interface ExaStructuredProduct {
  title: string;
  price: string;
  currency: string;
  sourceUrl: string;
  sourceName: string;
}

export interface ExaStructuredResult {
  products: ExaStructuredProduct[];
  /** Field-level grounding citations from Exa */
  grounding: Array<{
    field: string;
    citations: Array<{ url: string; title: string }>;
    confidence: string;
  }>;
}

// ─── Output Schema for structured search ────────────────────────────────────

const PRODUCT_PRICING_SCHEMA = {
  type: "object" as const,
  properties: {
    products: {
      type: "array" as const,
      description: "Product listings with pricing found on the page",
      items: {
        type: "object" as const,
        properties: {
          title: { type: "string" as const, description: "Product name" },
          price: { type: "string" as const, description: "Price with currency symbol, e.g. $29.99" },
          currency: { type: "string" as const, description: "Currency code: USD, EUR, or GBP" },
          sourceUrl: { type: "string" as const, description: "Direct URL to the product page" },
          sourceName: { type: "string" as const, description: "Name of the store or website" },
        },
        required: ["title", "price", "sourceUrl"],
      },
    },
  },
  required: ["products"],
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function createClient(): Exa | null {
  if (!ENV.exaApiKey) return null;
  return new Exa(ENV.exaApiKey);
}

// ─── Raw Search (URLs + highlights) ─────────────────────────────────────────

/**
 * Search the web for product-related pages using Exa's neural search.
 * Returns URLs, titles, and highlights — suitable for the existing
 * scout pipeline that scrapes each URL afterwards.
 *
 * Uses `type: "auto"` for balanced relevance and speed (~1s).
 */
async function searchProducts(
  query: string,
  maxResults: number = 10,
): Promise<ExaSearchResult[]> {
  const exa = createClient();
  if (!exa) return [];

  try {
    const results = await exa.search(query, {
      type: "auto",
      numResults: maxResults,
      contents: {
        highlights: true,
      },
    });

    return results.results.map((r: any) => ({
      url: r.url as string,
      title: (r.title as string) ?? "",
      snippet: ((r.highlights as string[]) ?? []).join(" ... "),
      highlights: (r.highlights as string[]) ?? [],
      publishedDate: (r.publishedDate as string) ?? null,
    }));
  } catch (err) {
    logger.warn({ query, err }, "Exa: search failed");
    return [];
  }
}

// ─── Structured Search (direct product extraction) ─────────────────────────

/**
 * Search the web and extract structured product pricing data in one call.
 * Uses Exa's `outputSchema` to synthesize grounded JSON directly —
 * no follow-up scraping needed.
 *
 * Uses `type: "deep-lite"` for quality synthesis (~4s) without the
 * full cost/latency of `deep` or `deep-reasoning`.
 */
async function structuredSearchProducts(
  query: string,
  maxResults: number = 10,
): Promise<ExaStructuredResult> {
  const exa = createClient();
  if (!exa) return { products: [], grounding: [] };

  try {
    const results = await exa.search(query, {
      type: "deep-lite",
      numResults: maxResults,
      systemPrompt:
        "Prefer official product pages and reputable stores. " +
        "Collapse duplicate listings for the same product. " +
        "Keep prices accurate and grounded in the source content. " +
        "Exclude marketplace third-party sellers when a direct store price is available.",
      outputSchema: PRODUCT_PRICING_SCHEMA,
      contents: {
        highlights: true,
      },
    });

    const output = (results as any).output;
    const content = output?.content as ExaStructuredProduct[] | undefined;
    const grounding = output?.grounding as ExaStructuredResult["grounding"] | undefined;

    if (!content) {
      logger.info({ query }, "Exa: structured search returned no content");
      return { products: [], grounding: [] };
    }

    // Normalize: the schema declares `products` as an array
    const products = Array.isArray(content)
      ? content
      : Array.isArray((content as any).products)
        ? (content as any).products as ExaStructuredProduct[]
        : [];

    logger.info(
      { query, productCount: products.length },
      "Exa: structured search completed",
    );

    return {
      products: products.slice(0, maxResults),
      grounding: grounding ?? [],
    };
  } catch (err) {
    logger.warn({ query, err }, "Exa: structured search failed");
    return { products: [], grounding: [] };
  }
}

// ─── Content Extraction for known URLs ──────────────────────────────────────

/**
 * Get clean content from specific URLs — useful for re-scraping
 * or extracting prices from URLs found by other search providers.
 */
async function getContents(
  urls: string[],
): Promise<Array<{ url: string; title: string; text: string }>> {
  const exa = createClient();
  if (!exa || urls.length === 0) return [];

  try {
    const results = await exa.getContents(urls, {
      text: { maxCharacters: 5000 },
    });

    return results.results.map((r: any) => ({
      url: r.url as string,
      title: (r.title as string) ?? "",
      text: (r.text as string) ?? "",
    }));
  } catch (err) {
    logger.warn({ urlCount: urls.length, err }, "Exa: getContents failed");
    return [];
  }
}

// ─── Exported Service ────────────────────────────────────────────────────────

export const exaSearchService = {
  searchProducts,
  structuredSearchProducts,
  getContents,
};
