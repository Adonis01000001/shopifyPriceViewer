import "dotenv/config";
import { competitorDiscoveryService } from "../services/competitor-discovery.service.ts";
import { priceMonitoringService } from "../services/price-monitoring.service.ts";
import { requireDb } from "./db-assert";
import { products, cronRuns } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";

async function main() {
  const db = await requireDb() as any;

  const prods = await db.select().from(products).where(eq(products.isActive, true)).limit(10);
  console.log("=== 10 Electronic Products ===");
  prods.forEach((p: any, i: number) => {
    console.log("  " + (i+1) + ". " + p.title.substring(0,55) + " | $" + p.price + " | " + p.sku);
  });

  if (prods.length > 0) {
    const p = prods[0];
    console.log("\n=== Competitor Discovery for: " + p.title.substring(0,40) + " ===");
    try {
      const result = await competitorDiscoveryService.discoverForProduct(p.userId, p.id, { country: "US", maxResults: 5 });
      console.log("  Total found: " + result.totalFound);
      console.log("  New candidates: " + result.newCandidates);
      result.candidates.slice(0, 5).forEach((c: any, i: number) => {
        console.log("  " + (i+1) + ". " + c.domain + " (conf: " + c.confidence + ")");
      });
    } catch (err: any) {
      console.log("  Error: " + err.message);
    }
  }

  console.log("\n=== Price Monitoring Run ===");
  try {
    const r = await priceMonitoringService.runFullMonitoring();
    console.log("  Processed: " + r.productsProcessed + " | Updated: " + r.productsUpdated + " | Changes: " + r.changesDetected + " | Errors: " + r.errors);
  } catch (err: any) {
    console.log("  Error: " + err.message);
  }

  const runs = await db.select().from(cronRuns).orderBy(desc(cronRuns.startedAt)).limit(5);
  console.log("\n=== Recent Cron Runs ===");
  runs.forEach((r: any) => {
    console.log("  " + r.jobType + " | " + r.status + " | processed: " + r.productsProcessed + " | changes: " + r.changesDetected);
  });

  console.log("\nDone!");
  process.exit(0);
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
