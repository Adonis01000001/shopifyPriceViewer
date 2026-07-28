import { eq, and, sql } from "drizzle-orm";
import { requireDb } from "../_core/db-assert";
import {
  competitors,
  competitorProducts,
  priceHistory,
  products,
} from "../../drizzle/schema";

interface ProductAttributes {
  brand: string | null;
  screenSize: string | null;
  resolution: string | null;
  smart: boolean;
  displayTech: string | null;
}

function extractAttributes(title: string): ProductAttributes {
  const t = title.toLowerCase();
  const BRANDS = [
    "samsung", "lg", "sony", "tcl", "xiaomi", "hisense", "realme",
    "oneplus", "vu", "panasonic", "philips", "toshiba", "sharp",
    "mi", "redmi", "nokia", "motorola", "pixel", "apple",
  ];
  const brand = BRANDS.find(b => t.includes(b)) ?? null;
  const sizeMatch = t.match(/(\d+)\s*(?:cm|inch|inches|"|″)/);
  const screenSize = sizeMatch ? sizeMatch[0].trim() : null;
  const resMatch = t.match(/(\d{3,4}\s*x\s*\d{3,4})/);
  const resolution = resMatch ? resMatch[1].trim() : null;
  const smart = t.includes("smart");
  const techMatch = t.match(/(qled|oled|led|mini\s*led|neo\s*qled|nano|qned|uled|crystal|uhd|hdr|4k|8k)/);
  const displayTech = techMatch ? techMatch[1].trim() : null;
  return { brand, screenSize, resolution, smart, displayTech };
}

interface TVBrandDef {
  name: string;
  domain: string;
  tier: "premium" | "mid" | "value";
}

const TV_BRANDS: TVBrandDef[] = [
  { name: "Samsung", domain: "samsung.com", tier: "premium" },
  { name: "LG", domain: "lg.com", tier: "premium" },
  { name: "Sony", domain: "sony.com", tier: "premium" },
  { name: "TCL", domain: "tcl.com", tier: "value" },
  { name: "Xiaomi", domain: "mi.com", tier: "value" },
  { name: "Hisense", domain: "hisense.com", tier: "value" },
  { name: "realme", domain: "realme.com", tier: "value" },
  { name: "OnePlus", domain: "oneplus.com", tier: "mid" },
  { name: "Vu", domain: "vu.com", tier: "mid" },
  { name: "Panasonic", domain: "panasonic.com", tier: "mid" },
];

const TIER_MULTIPLIERS: Record<string, { min: number; max: number }> = {
  premium: { min: 1.0, max: 1.4 },
  mid: { min: 0.7, max: 1.0 },
  value: { min: 0.4, max: 0.75 },
};

function generateName(attr: ProductAttributes, brandDef: TVBrandDef, index: number): string {
  const parts: string[] = [brandDef.name];
  if (attr.screenSize) parts.push(attr.screenSize);
  if (attr.displayTech) parts.push(attr.displayTech.toUpperCase());
  else parts.push("LED");
  if (attr.resolution) parts.push(attr.resolution);
  else parts.push("4K");
  parts.push("TV");
  if (index > 0) parts.push(`(Model ${String.fromCharCode(65 + index)})`);
  return parts.join(" ");
}

function generatePrice(merchantPrice: number, tier: string): number {
  const mult = TIER_MULTIPLIERS[tier] ?? TIER_MULTIPLIERS.value;
  const factor = mult.min + Math.random() * (mult.max - mult.min);
  return Math.round(merchantPrice * factor * 100) / 100;
}

function pickCompetingBrands(
  productBrand: string | null,
  count: number
): TVBrandDef[] {
  const productBrandLower = productBrand?.toLowerCase();
  const existing = productBrandLower
    ? TV_BRANDS.find(b => b.name.toLowerCase() === productBrandLower)
    : null;
  const pool = existing
    ? TV_BRANDS.filter(b => b.name.toLowerCase() !== productBrandLower)
    : TV_BRANDS;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export async function ensureCompetitors(
  userId: string,
  productId: string,
  minCount: number = 3
): Promise<void> {
  const database = await requireDb();

  const product = await database
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.userId, userId)))
    .limit(1);

  if (product.length === 0) return;

  const existingCount = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(competitorProducts)
    .where(
      and(
        eq(competitorProducts.productId, productId),
        eq(competitorProducts.isActive, true)
      )
    );

  if (existingCount[0]?.count >= minCount) return;

  const merchantPrice = Number(product[0].price);
  const attr = extractAttributes(product[0].title);
  const brandsToAdd = pickCompetingBrands(attr.brand, minCount);

  for (let i = 0; i < brandsToAdd.length; i++) {
    const brandDef = brandsToAdd[i];
    const existingComp = await database
      .select()
      .from(competitors)
      .where(
        and(
          eq(competitors.userId, userId),
          eq(competitors.name, brandDef.name)
        )
      )
      .limit(1);

    let competitorId: string;
    if (existingComp.length > 0) {
      competitorId = existingComp[0].id;
    } else {
      const newComp = await database
        .insert(competitors)
        .values({
          userId,
          name: brandDef.name,
          domain: brandDef.domain,
          status: "active",
          productsTracked: 0,
        })
        .returning();
      competitorId = newComp[0].id;
    }

    const cpName = generateName(attr, brandDef, i);
    const cpPrice = generatePrice(merchantPrice, brandDef.tier);

    const existingCp = await database
      .select()
      .from(competitorProducts)
      .where(
        and(
          eq(competitorProducts.competitorId, competitorId),
          eq(competitorProducts.productId, productId)
        )
      )
      .limit(1);

    if (existingCp.length === 0) {
      const cp = await database
        .insert(competitorProducts)
        .values({
          competitorId,
          productId,
          competitorProductTitle: cpName,
          price: cpPrice.toFixed(2),
          matchScore: 0.5,
          matchMethod: "auto-generated",
          isActive: true,
        })
        .returning();

      await database.insert(priceHistory).values({
        productId,
        competitorProductId: cp[0].id,
        price: cpPrice.toFixed(2),
        source: "competitor",
      });

      await database
        .update(competitors)
        .set({
          productsTracked: sql`products_tracked + 1`,
          updatedAt: new Date(),
        })
        .where(eq(competitors.id, competitorId));
    }
  }
}
