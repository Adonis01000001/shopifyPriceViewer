export const PRICE_RADAR_ENGINE_NAME = "Price Radar" as const;

export type PriceRadarRenderMode = "http" | "browser";
export type PriceRadarPageKind =
  | "product"
  | "category"
  | "pagination"
  | "sitemap"
  | "other";
export type PriceRadarAvailability =
  | "in_stock"
  | "out_of_stock"
  | "preorder"
  | "unknown";

export interface PriceRadarCrawlPolicy {
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  requestTimeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  minRequestIntervalMs: number;
  renderMode: "auto" | PriceRadarRenderMode;
  respectRobotsTxt: boolean;
}

export const DEFAULT_PRICE_RADAR_POLICY: PriceRadarCrawlPolicy = {
  maxPages: 250,
  maxDepth: 5,
  concurrency: 4,
  requestTimeoutMs: 20_000,
  maxRetries: 3,
  retryBaseDelayMs: 750,
  minRequestIntervalMs: 300,
  renderMode: "auto",
  respectRobotsTxt: true,
};

export interface PriceRadarQueueItem {
  url: string;
  depth: number;
  referrerUrl: string | null;
  kindHint?: PriceRadarPageKind;
}

export interface PriceRadarFetchedPage {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  contentType: string;
  html: string;
  renderMode: PriceRadarRenderMode;
  responseTimeMs: number;
  fetchedAt: Date;
  retryCount: number;
}

export interface PriceRadarProduct {
  name: string;
  brand: string | null;
  price: string | null;
  basePrice: string | null;
  salePrice: string | null;
  currency: string | null;
  previousPrice: string | null;
  discountPercent: string | null;
  productUrl: string;
  images: string[];
  availability: PriceRadarAvailability;
  sku: string | null;
  barcode: string | null;
  gtin: string | null;
  mpn: string | null;
  modelNumber: string | null;
  category: string | null;
  attributes: Record<string, string>;
  rating: number | null;
  reviewCount: number | null;
  seller: string | null;
  condition: string | null;
  variant: string | null;
  quantity: number | null;
  unit: string | null;
  shippingPrice: string | null;
  taxAmount: string | null;
  discountAmount: string | null;
  couponAmount: string | null;
  couponCode: string | null;
  membershipPrice: string | null;
  priceType: string | null;
  structuredMetadata: Record<string, unknown>;
  jsonLd: Record<string, unknown> | null;
  extractionMethod: string;
  extractionConfidence: number;
}

export interface PriceRadarExtractionResult {
  product: PriceRadarProduct | null;
  pageKind: PriceRadarPageKind;
  discoveredUrls: string[];
  warnings: string[];
  methods: string[];
}

export interface PriceRadarCrawlProgress {
  queued: number;
  visited: number;
  succeeded: number;
  failed: number;
  productsExtracted: number;
}

export interface PriceRadarCrawlResult extends PriceRadarCrawlProgress {
  jobId: string;
  status: "completed" | "partial" | "failed" | "cancelled";
}
