import { chromium, type Browser, type Page } from "playwright";
import { eq } from "drizzle-orm";
import { requireDb } from "../_core/db-assert";
import { scrapeJobs } from "../../drizzle/schema";
import { logger } from "../_core/logger";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScrapedProduct {
  title: string;
  price: string;
  currency: string;
  imageUrl: string | null;
  productUrl: string | null;
  sku: string | null;
}

export interface ScrapeResult {
  products: ScrapedProduct[];
  scrapeJobId: string;
  status: "success" | "partial" | "failed";
  errorMessage: string | null;
}

// ─── Concurrency Semaphore ───────────────────────────────────────────────────

class Semaphore {
  private running = 0;
  private queue: (() => void)[] = [];
  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++;
      return;
    }
    await new Promise<void>(resolve => this.queue.push(resolve));
    this.running++;
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }
}

const scrapeSemaphore = new Semaphore(3);

// ─── Selectors ───────────────────────────────────────────────────────────────

const PRODUCT_CONTAINER_SELECTORS = [
  // Shopify-specific
  ".product-card",
  ".product-grid__item",
  ".grid__item .card",
  ".grid-product__content",
  ".product-grid-item",
  // Amazon-specific
  '[data-component-type="s-search-result"]',
  '.s-result-item[data-asin]',
  // Generic e-commerce
  '[class*="product-card"]',
  '[class*="productCard"]',
  '[class*="product-grid"] article',
  '[class*="product_list"] li',
  // Semantic fallback
  "article.card",
];

const TITLE_SELECTORS = [
  "h2", "h3", "h4",
  '[class*="title"]', '[class*="name"]',
  ".card__heading",
  // Amazon-specific
  "h2 a span",
  '.a-text-normal',
];
const PRICE_SELECTORS = [
  '[class*="price"]', ".money", ".price__regular", '[class*="Price"]',
  // Amazon-specific
  '.a-price .a-offscreen',
  '.a-price-whole',
];
const IMAGE_SELECTORS = [
  "img[src]", "img[data-src]", "img[data-lazy-src]",
  // Amazon-specific
  '.s-image[src]',
  'img.s-image',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parsePrice(raw: string): { value: string; currency: string } | null {
  if (!raw) return null;
  const match = raw.match(/(\$|€|£|USD|EUR|GBP)?\s*([0-9]{1,3}(?:[,.][0-9]{3})*(?:[,.][0-9]{2})|[0-9]+(?:[,.][0-9]{2})?)/);
  if (!match) return null;
  const currencyMap: Record<string, string> = { "$": "USD", "€": "EUR", "£": "GBP" };
  const currency = currencyMap[match[1] ?? ""] || "USD";
  let value = match[2].replace(/,/g, "");
  if (/^\d{1,3}\.\d{3}$/.test(value)) {
    value = value.replace(".", "");
  }
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) return null;
  return { value: num.toFixed(2), currency };
}

// ─── Page Scraping ───────────────────────────────────────────────────────────

async function scrapePage(page: Page, url: string): Promise<ScrapedProduct[]> {
  logger.info({ url }, "Scraping competitor page");

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {
    throw new Error(`Timeout loading ${url}`);
  });

  // Check if this is an Amazon URL — needs extra wait for JS rendering
  const isAmazon = /amazon\.(com|co\.uk|de|fr|ca|in|com\.au|it|es|nl|com\.br|jp|sg|ae|se|pl|eg|tr|sa)/i.test(url);
  if (isAmazon) {
    // Amazon is JS-heavy; wait for product containers to appear
    try {
      await page.waitForSelector('[data-component-type="s-search-result"]', { timeout: 15000 });
    } catch {
      // Amazon may have returned a CAPTCHA or blocked page — log the page title for debugging
      const title = await page.title().catch(() => "unknown");
      const bodySnippet = await page.textContent("body").catch(() => "").then(t => t.slice(0, 500));
      logger.warn({ url, pageTitle: title, bodySnippet }, "Amazon: no product containers found — possible CAPTCHA/block");
      return [];
    }
    await page.waitForTimeout(2000).catch(() => {});
  } else {
    // Wait for JS-rendered content
    await page.waitForTimeout(2000).catch(() => {});
  }

  // Try each selector strategy
  for (const containerSel of PRODUCT_CONTAINER_SELECTORS) {
    try {
      const containers = await page.locator(containerSel).all();
      if (containers.length < 1) continue;

      const products: ScrapedProduct[] = [];
      const seen = new Set<string>();

      for (const container of containers.slice(0, 60)) {
        try {
          // Title
          let title: string | null = null;
          for (const sel of TITLE_SELECTORS) {
            const count = await container.locator(sel).count().catch(() => 0);
            if (count > 0) {
              const t = await container.locator(sel).first().textContent().catch(() => null);
              if (t) { title = t.trim(); if (title.length > 2) break; }
            }
          }
          if (!title || title.length < 3) continue;

          const key = title.toLowerCase().slice(0, 80);
          if (seen.has(key)) continue;
          seen.add(key);

          // Price
          let price = "0.00";
          let currency = "USD";
          for (const sel of PRICE_SELECTORS) {
            const count = await container.locator(sel).count().catch(() => 0);
            if (count > 0) {
              const raw = (await container.locator(sel).first().textContent().catch(() => null))?.trim() ?? "";
              const parsed = parsePrice(raw);
              if (parsed) { price = parsed.value; currency = parsed.currency; break; }
            }
          }

          // Image
          let imageUrl: string | null = null;
          for (const sel of IMAGE_SELECTORS) {
            const count = await container.locator(sel).count().catch(() => 0);
            if (count > 0) {
              const imgEl = container.locator(sel).first();
              const src1 = await imgEl.getAttribute("src").catch(() => null);
              const src2 = src1 ?? await imgEl.getAttribute("data-src").catch(() => null);
              imageUrl = src2 ?? await imgEl.getAttribute("data-lazy-src").catch(() => null);
              if (imageUrl) break;
            }
          }

          // Product URL
          let productUrl: string | null = null;
          const linkCount = await container.locator("a[href]").count().catch(() => 0);
          if (linkCount > 0) {
            productUrl = (await container.locator("a[href]").first().getAttribute("href").catch(() => null))?.trim() ?? null;
          }

          products.push({ title, price, currency, imageUrl, productUrl, sku: null });
        } catch { /* skip individual product */ }
      }

      if (products.length > 0) {
        logger.info({ count: products.length, selector: containerSel }, "Scraped products");
        return products;
      }
    } catch { /* try next selector */ }
  }

  return [];
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const scrapingService = {
  async scrapeCompetitorSite(
    competitorId: string,
    domain: string,
    searchQuery?: string,
  ): Promise<ScrapeResult> {
    const database = await requireDb();

    const [job] = await database.insert(scrapeJobs).values({
      competitorId,
      status: "running",
      startedAt: new Date(),
    }).returning();

    await scrapeSemaphore.acquire();
    let browser: Browser | null = null;

    try {
      browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

      const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        viewport: { width: 1920, height: 1080 },
        locale: "en-US",
        timezoneId: "America/New_York",
        extraHTTPHeaders: {
          "Accept-Language": "en-US,en;q=0.9",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
          "Connection": "keep-alive",
          "Upgrade-Insecure-Requests": "1",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
          "Cache-Control": "max-age=0",
        },
      });

      const page = await context.newPage();

      // Block unnecessary resources to speed up loading and reduce detection
      await page.route("**/*.{woff,woff2,ttf,otf,eot}", route => route.abort()).catch(() => {});
      await page.route("**/analytics/**", route => route.abort()).catch(() => {});
      await page.route("**/tracking/**", route => route.abort()).catch(() => {});
      await page.route("**/ads/**", route => route.abort()).catch(() => {});
      await page.route("**/pixel/**", route => route.abort()).catch(() => {});
      await page.route("**/beacon**", route => route.abort()).catch(() => {});
      // Block images and stylesheets on Amazon to speed up loading
      if (isAmazon) {
        await page.route("**/*.{png,jpg,jpeg,gif,svg,webp}", route => route.abort()).catch(() => {});
        await page.route("**/*.css", route => route.abort()).catch(() => {});
      }

      // Override navigator.webdriver to avoid headless detection
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        // @ts-ignore
        window.chrome = { runtime: {} };
      });

      let products: ScrapedProduct[] = [];
      const baseUrl = domain.startsWith("http") ? domain : `https://${domain}`;
      const isAmazon = /amazon\.(com|co\.uk|de|fr|ca|in|com\.au|it|es|nl|com\.br|jp|sg|ae|se|pl|eg|tr|sa)/i.test(domain);
      const urls: string[] = [];

      if (isAmazon) {
        // Amazon-specific URL patterns
        if (searchQuery) {
          urls.push(`${baseUrl}/s?k=${encodeURIComponent(searchQuery)}`);
          urls.push(`${baseUrl}/s?k=${encodeURIComponent(searchQuery)}&ref=nb_sb_noss`);
        } else {
          urls.push(`${baseUrl}/s?k=best+sellers`);
          urls.push(`${baseUrl}/gp/bestsellers`);
        }
      } else {
        if (searchQuery) {
          urls.push(`${baseUrl}/search?q=${encodeURIComponent(searchQuery)}`);
          urls.push(`${baseUrl}/search?type=product&q=${encodeURIComponent(searchQuery)}`);
        }
        urls.push(`${baseUrl}/collections/all`);
        urls.push(`${baseUrl}/products`);
      }

      for (const url of urls) {
        products = await scrapePage(page, url);
        if (products.length > 0) break;
      }

      await context.close();

      const finalStatus = products.length > 0 ? "success" : "failed";
      await database.update(scrapeJobs).set({
        status: finalStatus,
        completedAt: new Date(),
        productsScraped: products.length,
        errorMessage: products.length === 0 ? "No products found" : null,
      }).where(eq(scrapeJobs.id, job.id));

      return {
        products,
        scrapeJobId: job.id,
        status: finalStatus,
        errorMessage: products.length === 0
          ? "Could not find products on this competitor site. The site structure may not be supported yet."
          : null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error({ err: error, domain, competitorId }, "Scraping failed");

      await database.update(scrapeJobs).set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: message.slice(0, 500),
      }).where(eq(scrapeJobs.id, job.id));

      return {
        products: [],
        scrapeJobId: job.id,
        status: "failed",
        errorMessage: "Failed to scrape competitor site. Please try again later.",
      };
    } finally {
      await browser?.close().catch(() => {});
      scrapeSemaphore.release();
    }
  },
};
