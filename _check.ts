import { requireDb } from './server/_core/db-assert';
import { users, products, competitors, competitorProducts } from './drizzle/schema';

const db = await requireDb();

const allUsers = await db.select().from(users);
console.log('=== USERS (' + allUsers.length + ') ===');
for (const u of allUsers) {
  console.log(`  [${u.id}] ${u.email} | role=${u.role} | ${u.createdAt}`);
}

const allProducts = await db.select({ id: products.id, title: products.title, price: products.price, status: products.status, userId: products.userId }).from(products);
console.log('\n=== PRODUCTS (' + allProducts.length + ') ===');
for (const p of allProducts) {
  console.log(`  [${p.id}] "${p.title}" | $${p.price} | status=${p.status} | userId=${p.userId}`);
}

const allCompetitors = await db.select({ id: competitors.id, name: competitors.name, domain: competitors.domain, userId: competitors.userId }).from(competitors);
console.log('\n=== COMPETITORS (' + allCompetitors.length + ') ===');
for (const c of allCompetitors) {
  console.log(`  [${c.id}] "${c.name}" | ${c.domain} | userId=${c.userId}`);
}

const allCp = await db.select({ id: competitorProducts.id, productId: competitorProducts.productId, competitorId: competitorProducts.competitorId, price: competitorProducts.price, title: competitorProducts.competitorProductTitle }).from(competitorProducts);
console.log('\n=== COMPETITOR PRODUCTS (' + allCp.length + ') ===');
for (const cp of allCp) {
  console.log(`  [${cp.id}] productId=${cp.productId} | competitorId=${cp.competitorId} | $${cp.price} | "${cp.title}"`);
}
