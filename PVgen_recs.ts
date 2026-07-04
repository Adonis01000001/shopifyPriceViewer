import { getDb, closeDb } from "./server/db";
import { recommendationService } from "./server/services/recommendation.service";
import { products } from "./drizzle/schema";

async function main() {
  const db = await getDb();
  if (!db) {
    console.log("ERROR: DB not available");
    process.exit(1);
  }
  const allProducts = await db.select().from(products);
  console.log("Found " + allProducts.length + " products");
  let generated = 0;
  for (const product of allProducts) {
    try {
      const rec = await recommendationService.generateForProduct(
        product.userId,
        product.id
      );
      if (rec) {
        console.log(
          "OK: " +
            product.title +
            " $" +
            rec.currentPrice +
            " -> $" +
            rec.recommendedPrice
        );
        generated++;
      } else {
        console.log("SKIP: " + product.title + " (no competitor prices)");
      }
    } catch (err) {
      console.log("FAIL: " + product.title + " " + err);
    }
  }
  console.log("Done. Generated " + generated + " recommendations.");
  await closeDb();
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
