import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { PriceRadarPageKind } from "./types";

export function normalizeCompetitorDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

const PRODUCT_HINTS = [
  "/product/",
  "/products/",
  "/p/",
  "/item/",
  "/dp/",
  "/sku/",
];
const CATEGORY_HINTS = [
  "/category/",
  "/categories/",
  "/collection/",
  "/collections/",
  "/shop/",
  "/catalog/",
];
const PAGINATION_KEYS = new Set(["page", "p", "pg", "offset"]);
const REJECTED_EXTENSIONS =
  /\.(?:7z|avi|css|csv|docx?|eot|gif|gz|ico|jpe?g|js|json|m4a|mov|mp3|mp4|mpeg|pdf|png|pptx?|rar|rss|svg|tar|tiff?|ttf|txt|webm|webp|woff2?|xml|zip)$/i;
const REJECTED_PATHS =
  /\/(?:account|admin|auth|blog|cart|checkout|contact|feed|login|logout|privacy|register|search|support|terms)(?:\/|$)/i;

export function canonicalizeUrl(input: string, base?: string): string | null {
  try {
    const url = new URL(input, base);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if (
      (url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")
    ) {
      url.port = "";
    }
    for (const key of Array.from(url.searchParams.keys())) {
      if (
        key.toLowerCase().startsWith("utm_") ||
        ["fbclid", "gclid", "ref", "source"].includes(key.toLowerCase())
      ) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/{2,}/g, "/");
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

export function isSameSite(candidate: string, root: string): boolean {
  const a = new URL(candidate).hostname.replace(/^www\./, "");
  const b = new URL(root).hostname.replace(/^www\./, "");
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export function classifyUrl(urlValue: string): PriceRadarPageKind {
  const url = new URL(urlValue);
  const path = url.pathname.toLowerCase();
  if (path.endsWith("sitemap.xml") || path.includes("/sitemap")) return "sitemap";
  if (PRODUCT_HINTS.some(hint => path.includes(hint))) return "product";
  if (
    Array.from(url.searchParams.keys()).some(key =>
      PAGINATION_KEYS.has(key.toLowerCase())
    )
  ) {
    return "pagination";
  }
  if (CATEGORY_HINTS.some(hint => path.includes(hint))) return "category";
  return "other";
}

export function shouldCrawlUrl(candidate: string, root: string): boolean {
  const canonical = canonicalizeUrl(candidate, root);
  if (!canonical || !isSameSite(canonical, root)) return false;
  const url = new URL(canonical);
  if (REJECTED_EXTENSIONS.test(url.pathname)) return false;
  if (REJECTED_PATHS.test(url.pathname)) return false;
  if (url.searchParams.size > 5 || url.pathname.length > 500) return false;
  return true;
}

export function extractInternalLinks(html: string, pageUrl: string): string[] {
  const urls = new Set<string>();
  const hrefRegex = /<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["'][^>]*>/gi;
  for (const match of Array.from(html.matchAll(hrefRegex))) {
    const url = canonicalizeUrl(match[1], pageUrl);
    if (url && shouldCrawlUrl(url, pageUrl)) urls.add(url);
  }
  return Array.from(urls);
}

export function extractSitemapUrls(xml: string, rootUrl: string): string[] {
  const urls = new Set<string>();
  for (const match of Array.from(
    xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)
  )) {
    const decoded = match[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
    const url = canonicalizeUrl(decoded, rootUrl);
    if (url && isSameSite(url, rootUrl)) urls.add(url);
  }
  return Array.from(urls);
}

function isPrivateAddress(address: string): boolean {
  if (address === "::1" || address === "0.0.0.0") return true;
  if (address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:"))
    return true;
  if (!isIP(address).toString()) return true;
  const parts = address.split(".").map(Number);
  if (parts.length !== 4) return false;
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 0
  );
}

export async function assertPublicUrl(urlValue: string): Promise<void> {
  const url = new URL(urlValue);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are supported");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new Error("Private network targets are not allowed");
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(entry => isPrivateAddress(entry.address))) {
    throw new Error("Private network targets are not allowed");
  }
}

export function parseRobotsTxt(content: string): {
  disallow: string[];
  crawlDelayMs: number | null;
  sitemaps: string[];
} {
  const disallow: string[] = [];
  const sitemaps: string[] = [];
  let applies = false;
  let crawlDelayMs: number | null = null;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") applies = value === "*";
    else if (key === "sitemap" && value) sitemaps.push(value);
    else if (applies && key === "disallow" && value) disallow.push(value);
    else if (applies && key === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0)
        crawlDelayMs = Math.min(seconds * 1000, 60_000);
    }
  }
  return { disallow, crawlDelayMs, sitemaps };
}

export function isAllowedByRobots(urlValue: string, disallow: string[]): boolean {
  const path = new URL(urlValue).pathname;
  return !disallow.some(rule => rule !== "/" && path.startsWith(rule)) &&
    !disallow.includes("/");
}
