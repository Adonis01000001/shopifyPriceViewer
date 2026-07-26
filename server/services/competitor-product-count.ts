import { resolveProductDisplayName } from "./price-radar/extraction";
import { normalizeCompetitorDomain } from "./price-radar/url-policy";

interface CompetitorIdentity {
  id: string;
  domain: string;
}

interface MatchedProductIdentity {
  competitorProductUrl: string | null;
}

interface RadarProductIdentity {
  name: string;
  productUrl: string;
  sourceCompetitorId: string | null;
  sourceDomain: string;
  structuredMetadata: unknown;
}

function descriptionFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const description = (metadata as Record<string, unknown>).description;
  return typeof description === "string" ? description : null;
}

export function getVisibleRadarProducts<T extends RadarProductIdentity>(
  competitor: CompetitorIdentity,
  matchedProducts: readonly MatchedProductIdentity[],
  radarProducts: readonly T[]
): Array<{ product: T; displayName: string }> {
  const competitorDomain = normalizeCompetitorDomain(competitor.domain);
  const matchedUrls = new Set(
    matchedProducts
      .map(product => product.competitorProductUrl)
      .filter((url): url is string => !!url)
  );

  return radarProducts.flatMap(product => {
    const belongsToCompetitor =
      product.sourceCompetitorId === competitor.id ||
      normalizeCompetitorDomain(product.sourceDomain) === competitorDomain;
    if (!belongsToCompetitor || matchedUrls.has(product.productUrl)) return [];

    const displayName =
      resolveProductDisplayName(
        product.name,
        product.productUrl,
        descriptionFromMetadata(product.structuredMetadata)
      ) ?? product.name;
    if (
      competitorDomain === "amazon.com" &&
      /^Amazon(?:\.com)?$/i.test(displayName)
    ) {
      return [];
    }

    return [{ product, displayName }];
  });
}

export function countMergedCompetitorProducts(
  competitor: CompetitorIdentity,
  matchedProducts: readonly MatchedProductIdentity[],
  radarProducts: readonly RadarProductIdentity[]
): number {
  return (
    matchedProducts.length +
    getVisibleRadarProducts(competitor, matchedProducts, radarProducts).length
  );
}
