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
  if (path.endsWith("sitemap.xml") || path.includes("/sitemap"))
    return "sitemap";
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
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const version = isIP(normalized);

  if (version === 0) return true;

  if (version === 4) {
    const parts = normalized.split(".").map(Number);
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) {
      return true;
    }
    const [first, second, third] = parts;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && (second === 0 || second === 168)) ||
      (first === 198 &&
        (second === 18 || second === 19 || (second === 51 && third === 100))) ||
      (first === 203 && second === 0 && third === 113) ||
      first >= 224
    );
  }

  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) {
    const mappedIpv4 = normalized.slice("::ffff:".length);
    if (isIP(mappedIpv4) === 4) return isPrivateAddress(mappedIpv4);
  }

  const ipv6Parts = normalized.split("::");
  if (ipv6Parts.length <= 2) {
    const left = ipv6Parts[0] ? ipv6Parts[0].split(":") : [];
    const right = ipv6Parts[1] ? ipv6Parts[1].split(":") : [];
    const missing = 8 - left.length - right.length;
    if (missing >= 0) {
      const groups = [
        ...left,
        ...Array.from({ length: missing }, () => "0"),
        ...right,
      ].map(group => Number.parseInt(group, 16));
      if (
        groups.length === 8 &&
        groups.slice(0, 5).every(group => group === 0) &&
        groups[5] === 0xffff
      ) {
        const mappedIpv4 = [
          groups[6] >> 8,
          groups[6] & 0xff,
          groups[7] >> 8,
          groups[7] & 0xff,
        ].join(".");
        return isPrivateAddress(mappedIpv4);
      }
    }
  }

  return (
    /^f[cd]/.test(normalized) ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

export async function assertPublicUrl(urlValue: string): Promise<void> {
  const url = new URL(urlValue);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are supported");
  }
  if (url.username || url.password) {
    throw new Error("URLs with embedded credentials are not allowed");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Private network targets are not allowed");
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(entry => isPrivateAddress(entry.address))
  ) {
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

export function isAllowedByRobots(
  urlValue: string,
  disallow: string[]
): boolean {
  const path = new URL(urlValue).pathname;
  return (
    !disallow.some(rule => rule !== "/" && path.startsWith(rule)) &&
    !disallow.includes("/")
  );
}
