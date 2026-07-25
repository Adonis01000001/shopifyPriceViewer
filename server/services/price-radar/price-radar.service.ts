import type { Browser } from "playwright";
import { logger } from "../../_core/logger";
import { extractProductData, shouldRenderWithBrowser } from "./extraction";
import { priceRadarRepository } from "./repository";
import {
  assertPublicUrl,
  canonicalizeUrl,
  classifyUrl,
  extractSitemapUrls,
  isAllowedByRobots,
  parseRobotsTxt,
  shouldCrawlUrl,
} from "./url-policy";
import {
  DEFAULT_PRICE_RADAR_POLICY,
  PRICE_RADAR_ENGINE_NAME,
  type PriceRadarCrawlPolicy,
  type PriceRadarFetchedPage,
  type PriceRadarQueueItem,
} from "./types";

const USER_AGENT =
  "PriceRadarBot/1.0 (+https://example.invalid/price-radar; competitor-price-monitoring)";
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const activeRuns = new Map<string, AbortController>();
const hostLastRequest = new Map<string, number>();

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Crawl cancelled"));
      },
      { once: true }
    );
  });

function clampPolicy(
  overrides: Partial<PriceRadarCrawlPolicy>
): PriceRadarCrawlPolicy {
  return {
    maxPages: Math.min(Math.max(overrides.maxPages ?? 250, 1), 5_000),
    maxDepth: Math.min(Math.max(overrides.maxDepth ?? 5, 0), 12),
    concurrency: Math.min(Math.max(overrides.concurrency ?? 4, 1), 12),
    requestTimeoutMs: Math.min(
      Math.max(overrides.requestTimeoutMs ?? 20_000, 2_000),
      60_000
    ),
    maxRetries: Math.min(Math.max(overrides.maxRetries ?? 3, 0), 6),
    retryBaseDelayMs: Math.min(
      Math.max(overrides.retryBaseDelayMs ?? 750, 100),
      10_000
    ),
    minRequestIntervalMs: Math.min(
      Math.max(overrides.minRequestIntervalMs ?? 300, 0),
      60_000
    ),
    renderMode: overrides.renderMode ?? "auto",
    respectRobotsTxt: overrides.respectRobotsTxt ?? true,
  };
}

async function rateLimitHost(
  urlValue: string,
  delayMs: number,
  signal: AbortSignal
) {
  const host = new URL(urlValue).host;
  const wait = Math.max(0, (hostLastRequest.get(host) ?? 0) + delayMs - Date.now());
  if (wait) await sleep(wait, signal);
  hostLastRequest.set(host, Date.now());
}

async function fetchHttp(
  urlValue: string,
  policy: PriceRadarCrawlPolicy,
  signal: AbortSignal,
  crawlDelayMs: number
): Promise<PriceRadarFetchedPage> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      let current = urlValue;
      const started = Date.now();
      for (let redirects = 0; redirects <= 5; redirects++) {
        await assertPublicUrl(current);
        await rateLimitHost(
          current,
          Math.max(policy.minRequestIntervalMs, crawlDelayMs),
          signal
        );
        const timeout = AbortSignal.timeout(policy.requestTimeoutMs);
        const combined = AbortSignal.any([signal, timeout]);
        const response = await fetch(current, {
          redirect: "manual",
          signal: combined,
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5",
            "Accept-Language": "en-US,en;q=0.8",
          },
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) throw new Error("Redirect response missing Location");
          const next = canonicalizeUrl(location, current);
          if (!next) throw new Error("Invalid redirect target");
          current = next;
          continue;
        }
        if (response.status === 429 || response.status >= 500) {
          throw new Error(`Retryable HTTP ${response.status}`);
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const contentLength = Number(response.headers.get("content-length") ?? 0);
        if (contentLength > MAX_RESPONSE_BYTES)
          throw new Error("Response exceeds 5 MB limit");
        const html = await response.text();
        if (Buffer.byteLength(html, "utf8") > MAX_RESPONSE_BYTES)
          throw new Error("Response exceeds 5 MB limit");
        return {
          requestedUrl: urlValue,
          finalUrl: current,
          statusCode: response.status,
          contentType: response.headers.get("content-type") ?? "",
          html,
          renderMode: "http",
          responseTimeMs: Date.now() - started,
          fetchedAt: new Date(),
          retryCount: attempt,
        };
      }
      throw new Error("Too many redirects");
    } catch (error) {
      lastError = error;
      if (signal.aborted || attempt === policy.maxRetries) break;
      const jitter = Math.floor(Math.random() * 250);
      await sleep(policy.retryBaseDelayMs * 2 ** attempt + jitter, signal);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("HTTP fetch failed");
}

async function renderBrowser(
  browser: Browser,
  url: string,
  policy: PriceRadarCrawlPolicy,
  signal: AbortSignal
): Promise<PriceRadarFetchedPage> {
  await assertPublicUrl(url);
  const started = Date.now();
  const context = await browser.newContext({
    javaScriptEnabled: true,
    serviceWorkers: "block",
  });
  try {
    const page = await context.newPage();
    signal.addEventListener("abort", () => void page.close(), { once: true });
    await page.route("**/*", route => {
      const type = route.request().resourceType();
      if (["media", "font"].includes(type)) void route.abort();
      else void route.continue();
    });
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: policy.requestTimeoutMs,
    });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    return {
      requestedUrl: url,
      finalUrl: page.url(),
      statusCode: response?.status() ?? 200,
      contentType: response?.headers()["content-type"] ?? "text/html",
      html: await page.content(),
      renderMode: "browser",
      responseTimeMs: Date.now() - started,
      fetchedAt: new Date(),
      retryCount: 0,
    };
  } finally {
    await context.close();
  }
}

async function loadRobots(
  rootUrl: string,
  policy: PriceRadarCrawlPolicy,
  signal: AbortSignal
) {
  if (!policy.respectRobotsTxt)
    return { disallow: [], crawlDelayMs: null, sitemaps: [] as string[], raw: null };
  const url = new URL("/robots.txt", rootUrl).toString();
  try {
    const page = await fetchHttp(url, { ...policy, maxRetries: 0 }, signal, 0);
    const parsed = parseRobotsTxt(page.html);
    return { ...parsed, raw: page.html };
  } catch {
    return { disallow: [], crawlDelayMs: null, sitemaps: [] as string[], raw: null };
  }
}

async function executeCrawl(input: {
  userId: string;
  sourceId: string;
  jobId: string;
  rootUrl: string;
  policy: PriceRadarCrawlPolicy;
  signal: AbortSignal;
}) {
  const queue: PriceRadarQueueItem[] = [
    { url: input.rootUrl, depth: 0, referrerUrl: null },
  ];
  const visited = new Set<string>();
  const queued = new Set<string>([input.rootUrl]);
  const progress = { queued: 1, visited: 0, succeeded: 0, failed: 0, productsExtracted: 0 };
  const robots = await loadRobots(input.rootUrl, input.policy, input.signal);
  await priceRadarRepository.updateSource(input.userId, input.sourceId, {
    robotsTxt: robots.raw ?? undefined,
  });
  const crawlDelay = robots.crawlDelayMs ?? input.policy.minRequestIntervalMs;
  for (const sitemap of [
    ...robots.sitemaps,
    new URL("/sitemap.xml", input.rootUrl).toString(),
  ]) {
    const canonical = canonicalizeUrl(sitemap, input.rootUrl);
    if (canonical && !queued.has(canonical)) {
      queue.push({ url: canonical, depth: 0, referrerUrl: input.rootUrl, kindHint: "sitemap" });
      queued.add(canonical);
      progress.queued++;
    }
  }

  let browser: Browser | null = null;
  const running = new Set<Promise<void>>();
  const enqueue = (urlValue: string, item: PriceRadarQueueItem) => {
    const url = canonicalizeUrl(urlValue, item.url);
    if (
      !url ||
      queued.has(url) ||
      queued.size >= input.policy.maxPages * 4 ||
      item.depth + 1 > input.policy.maxDepth ||
      !shouldCrawlUrl(url, input.rootUrl) ||
      !isAllowedByRobots(url, robots.disallow)
    )
      return;
    queued.add(url);
    queue.push({ url, depth: item.depth + 1, referrerUrl: item.url });
    progress.queued++;
  };

  const processItem = async (item: PriceRadarQueueItem) => {
    if (input.signal.aborted || visited.has(item.url)) return;
    visited.add(item.url);
    progress.visited++;
    let fetched: PriceRadarFetchedPage | undefined;
    try {
      fetched = await fetchHttp(item.url, input.policy, input.signal, crawlDelay);
      if (/xml/i.test(fetched.contentType) || item.kindHint === "sitemap") {
        for (const url of extractSitemapUrls(fetched.html, input.rootUrl)) enqueue(url, item);
        await priceRadarRepository.recordPage({
          ...input,
          item,
          page: fetched,
          pageKind: "sitemap",
          status: "success",
        });
        progress.succeeded++;
        return;
      }
      if (!/html|xhtml/i.test(fetched.contentType))
        throw new Error(`Unsupported content type: ${fetched.contentType}`);
      let extractionStarted = Date.now();
      let extraction = extractProductData(fetched.html, fetched.finalUrl);
      if (
        input.policy.renderMode === "browser" ||
        (input.policy.renderMode === "auto" &&
          shouldRenderWithBrowser(fetched.html, extraction))
      ) {
        if (!browser) {
          const { chromium } = await import("playwright");
          browser = await chromium.launch({
            headless: true,
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
          });
        }
        fetched = await renderBrowser(browser, item.url, input.policy, input.signal);
        extractionStarted = Date.now();
        extraction = extractProductData(fetched.html, fetched.finalUrl);
      }
      const page = await priceRadarRepository.recordPage({
        ...input,
        item,
        page: fetched,
        pageKind: extraction.pageKind,
        status: "success",
        metadata: { methods: extraction.methods, warnings: extraction.warnings },
      });
      if (!page) return;
      let productId: string | undefined;
      if (extraction.product) {
        const product = await priceRadarRepository.upsertProduct({
          userId: input.userId,
          sourceId: input.sourceId,
          pageId: page.id,
          jobId: input.jobId,
          product: extraction.product,
        });
        productId = product.id;
        progress.productsExtracted++;
      }
      await priceRadarRepository.recordExtraction({
        userId: input.userId,
        jobId: input.jobId,
        pageId: page.id,
        productId,
        methods: extraction.methods,
        warnings: extraction.warnings,
        confidence: extraction.product?.extractionConfidence ?? 0,
        durationMs: Date.now() - extractionStarted,
      });
      for (const url of extraction.discoveredUrls) enqueue(url, item);
      progress.succeeded++;
    } catch (error) {
      progress.failed++;
      const message = error instanceof Error ? error.message : String(error);
      const page = await priceRadarRepository.recordPage({
        ...input,
        item,
        page: fetched,
        pageKind: item.kindHint ?? classifyUrl(item.url),
        status: input.signal.aborted ? "cancelled" : "failed",
        metadata: { error: message },
      });
      await priceRadarRepository.recordError({
        userId: input.userId,
        jobId: input.jobId,
        pageId: page?.id,
        url: item.url,
        stage: fetched ? "extraction" : "fetch",
        code: error instanceof Error ? error.name : "UNKNOWN",
        message: message.slice(0, 2_000),
        retryable: /timeout|429|5\d\d/i.test(message),
        retryCount: fetched?.retryCount ?? input.policy.maxRetries,
      });
      logger.warn({ jobId: input.jobId, url: item.url, error }, "Price Radar page failed");
    }
  };

  try {
    while (
      !input.signal.aborted &&
      progress.visited < input.policy.maxPages &&
      (queue.length > 0 || running.size > 0)
    ) {
      while (
        queue.length > 0 &&
        running.size < input.policy.concurrency &&
        progress.visited + running.size < input.policy.maxPages
      ) {
        const item = queue.shift()!;
        const promise = processItem(item).finally(() => running.delete(promise));
        running.add(promise);
      }
      if (running.size) await Promise.race(running);
    }
    await Promise.allSettled(running);
  } finally {
    const browserToClose = browser as Browser | null;
    if (browserToClose) await browserToClose.close();
  }
  const status = input.signal.aborted
    ? "cancelled"
    : progress.failed > 0 && progress.succeeded === 0
      ? "failed"
      : progress.failed > 0
        ? "partial"
        : "completed";
  await priceRadarRepository.updateJob(input.jobId, {
    status,
    pagesQueued: progress.queued,
    pagesVisited: progress.visited,
    pagesSucceeded: progress.succeeded,
    pagesFailed: progress.failed,
    productsExtracted: progress.productsExtracted,
    completedAt: new Date(),
  });
  await priceRadarRepository.updateSource(input.userId, input.sourceId, {
    lastCrawledAt: new Date(),
    status: status === "failed" ? "error" : "active",
  });
}

export const priceRadarService = {
  engineName: PRICE_RADAR_ENGINE_NAME,
  defaults: DEFAULT_PRICE_RADAR_POLICY,

  async createSource(input: {
    userId: string;
    competitorId?: string;
    name: string;
    url: string;
    crawlDelayMs?: number;
  }) {
    const baseUrl = canonicalizeUrl(input.url);
    if (!baseUrl) throw new Error("Invalid source URL");
    await assertPublicUrl(baseUrl);
    const domain = new URL(baseUrl).hostname;
    const existing = await priceRadarRepository.getSourceByDomain(
      input.userId,
      domain
    );
    if (existing) throw new Error("already active: A source for this domain already exists");
    if (
      input.competitorId &&
      !(await priceRadarRepository.assertCompetitorOwnership(
        input.userId,
        input.competitorId
      ))
    )
      throw new Error("Competitor not found");
    const matchedCompetitor =
      input.competitorId == null
        ? await priceRadarRepository.findCompetitorByDomain(
            input.userId,
            domain
          )
        : null;
    return priceRadarRepository.createSource({
      userId: input.userId,
      competitorId: input.competitorId ?? matchedCompetitor?.id,
      name: input.name,
      domain,
      baseUrl,
      crawlDelayMs: input.crawlDelayMs ?? DEFAULT_PRICE_RADAR_POLICY.minRequestIntervalMs,
    });
  },

  listSources: priceRadarRepository.listSources,

  async deleteSource(userId: string, sourceId: string) {
    return priceRadarRepository.updateSource(userId, sourceId, {
      isActive: false,
      status: "inactive",
    });
  },

  async startCrawl(
    userId: string,
    sourceId: string,
    overrides: Partial<PriceRadarCrawlPolicy>
  ) {
    const source = await priceRadarRepository.getSource(userId, sourceId);
    if (!source) throw new Error("Source not found");
    const active = await priceRadarRepository.findActiveJob(userId, sourceId);
    if (active) throw new Error("A crawl is already active for this source");
    const policy = clampPolicy(overrides);
    const job = await priceRadarRepository.createJob(
      userId,
      sourceId,
      source.baseUrl,
      policy
    );
    const controller = new AbortController();
    activeRuns.set(job.id, controller);
    queueMicrotask(() => {
      void priceRadarRepository.updateJob(job.id, {
        status: "running",
        startedAt: new Date(),
      });
      void executeCrawl({
        userId,
        sourceId,
        jobId: job.id,
        rootUrl: source.baseUrl,
        policy,
        signal: controller.signal,
      })
        .catch(async error => {
          logger.error({ jobId: job.id, error }, "Price Radar crawl failed");
          await priceRadarRepository.updateJob(job.id, {
            status: controller.signal.aborted ? "cancelled" : "failed",
            errorMessage:
              error instanceof Error ? error.message.slice(0, 2_000) : "Unknown crawl error",
            completedAt: new Date(),
          });
        })
        .finally(() => activeRuns.delete(job.id));
    });
    return job;
  },

  async cancelCrawl(userId: string, jobId: string) {
    const job = await priceRadarRepository.getJob(userId, jobId);
    if (!job) throw new Error("Crawl job not found");
    activeRuns.get(jobId)?.abort();
    return priceRadarRepository.updateJob(jobId, {
      status: "cancelled",
      completedAt: new Date(),
    });
  },

  getJob: priceRadarRepository.getJob,
  listJobs: priceRadarRepository.listJobs,
  listProducts: priceRadarRepository.listProducts,
  listErrors: priceRadarRepository.listErrors,
};
