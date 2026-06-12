/**
 * seed_all.ts — One-shot data seeder for all empty/underpopulated tables:
 *   notification_preferences, competitor_products (enrich), price_history (30 days),
 *   alerts, recommendations, scrape_jobs, activity_logs
 *
 * Run:  pnpm tsx seed_all.ts
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool });

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const rand = (lo: number, hi: number) => Math.random() * (hi - lo) + lo;
const esc = (s: string) => s.replace(/'/g, "''");

async function q(text: string, params?: any[]) {
  return pool.query(text, params);
}

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║    PriceVision — Comprehensive Data Seeder      ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // ── Load existing data ───────────────────────────────────────────────
  const usersR = await q("SELECT id FROM users");
  const prodsR  = await q("SELECT id, user_id, title, price, sku, currency FROM products WHERE is_active = true");
  const compsR  = await q("SELECT id, name, domain, user_id FROM competitors WHERE status = 'active'");
  const cpR     = await q("SELECT id, product_id, competitor_id FROM competitor_products");

  const uids = usersR.rows.map(r => r.id as string);
  const prods = prodsR.rows as any[];
  const comps = compsR.rows as any[];
  const cps   = cpR.rows as any[];

  const byUser: Record<string, any[]> = {};
  for (const p of prods) (byUser[p.user_id] ??= []).push(p);
  const matchSet = new Set(cps.map((c: any) => c.competitor_id + ":" + c.product_id));

  console.log(`  ${uids.length} users | ${prods.length} products | ${comps.length} competitors | ${cps.length} comp_products\n`);

  // ════════════════════════════════════════════════════════════════════
  // 1. Notification Preferences
  // ════════════════════════════════════════════════════════════════════
  // Count helper
  const count = async (t: string) => {
    const r = await pool.query("SELECT count(*)::int FROM " + t);
    return (r.rows[0] as any).count as number;
  };

  console.log("1/7  Notification Preferences");
  for (const uid of uids) {
    try {
      await pool.query(`INSERT INTO notification_preferences (user_id, email_notifications, in_app_notifications, frequency, price_drop_threshold, price_increase_threshold)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id) DO NOTHING`,
        [uid, Math.random() < 0.8, Math.random() < 0.9,
         pick(["realtime","hourly","daily","daily","daily","weekly"]),
         rand(3,15).toFixed(2), rand(3,10).toFixed(2)]);
    } catch { /* */ }
  }
  console.log(`   ✅ ${(await count("notification_preferences"))} rows\n`);

  // ════════════════════════════════════════════════════════════════════
  // 2. Enrich Competitor Products
  // ════════════════════════════════════════════════════════════════════
  console.log("2/7  Enriching Competitor Products");
  let newCP = 0;
  const methods = ["ai_embedding","sku_match","title_fuzzy","manual"];
  for (const c of comps) {
    for (const p of byUser[c.user_id] ?? []) {
      const key = c.id + ":" + p.id;
      if (matchSet.has(key)) continue;
      matchSet.add(key);
      const price = Number(p.price) || 9.99;
      try {
        await pool.query(`INSERT INTO competitor_products (competitor_id, product_id, competitor_product_url, competitor_product_title, price, currency, match_score, match_method, is_verified, is_active)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,
          [c.id, p.id, `https://${esc(c.domain)}/product/${esc(p.title.toLowerCase().replace(/[^a-z0-9]+/g,"-").slice(0,40))}`,
           `${esc(p.title).slice(0,80)} | ${esc(c.name)}`,
           (price * rand(0.82,1.18)).toFixed(2), p.currency||"USD",
           rand(0.70,0.98).toFixed(3), pick(methods), Math.random()<0.7]);
        newCP++;
      } catch { /* */ }
    }
  }
  console.log(`   ✅ +${newCP} new (total: ${(await count("competitor_products"))})\n`);

  // ════════════════════════════════════════════════════════════════════
  // 3. Price History — 30 days shopify + competitor per product
  // ════════════════════════════════════════════════════════════════════
  console.log("3/7  Price History (30 days per product)");
  // Batch insert price history using pool.query with parameterized multi-row VALUES
  const phBatchSize = 200;
  let phRows: any[][] = [];
  let phTotal = 0;
  const flushPH = async () => {
    if (!phRows.length) return;
    const colsPerRow = 7;
    const batches: string[] = [];
    const vals: any[] = [];
    let vi = 1;
    for (const row of phRows) {
      const placeholders = row.map(() => "$" + (vi++)).join(",");
      batches.push("(" + placeholders + ")");
      vals.push(...row);
    }
    try {
      await pool.query(
        `INSERT INTO price_history (product_id, competitor_product_id, price, currency, source, recorded_at, created_at) VALUES ${batches.join(",")}`,
        vals
      );
      phTotal += phRows.length;
    } catch (e: any) { console.log("   batch err:", e.message?.slice(0,80)); }
    phRows = [];
  };

  for (const p of prods) {
    const base = Number(p.price) || 9.99;
    for (let d = 29; d >= 0; d--) {
      const dt = new Date(); dt.setDate(dt.getDate()-d); dt.setHours(9,0,0,0);
      phRows.push([p.id, null, (base*rand(0.97,1.03)).toFixed(2), p.currency||"USD", "shopify", dt, dt]);
      if (phRows.length >= phBatchSize) await flushPH();
    }
  }
  await flushPH();
  console.log(`   ✅ shopify prices inserted`);

  // Competitor price history — batch insert
  const fresh = (await pool.query("SELECT id, product_id, price FROM competitor_products WHERE last_scraped_at IS NULL ORDER BY created_at DESC LIMIT 600")).rows as any[];
  let cphRows: any[][] = [];
  let cphTotal = 0;
  const flushCPH = async () => {
    if (!cphRows.length) return;
    const batches: string[] = [];
    const vals: any[] = [];
    let vi = 1;
    for (const row of cphRows) {
      const placeholders = row.map(() => "$" + (vi++)).join(",");
      batches.push("(" + placeholders + ")");
      vals.push(...row);
    }
    try {
      await pool.query(
        `INSERT INTO price_history (product_id, competitor_product_id, price, currency, source, recorded_at, created_at) VALUES ${batches.join(",")}`,
        vals
      );
      cphTotal += cphRows.length;
    } catch (e: any) { console.log("   cph batch err:", e.message?.slice(0,80)); }
    cphRows = [];
  };
  for (const cp of fresh) {
    const base = Number(cp.price) || 9.99;
    for (let d = 29; d >= 0; d--) {
      const dt = new Date(); dt.setDate(dt.getDate()-d); dt.setHours(14,0,0,0);
      cphRows.push([cp.product_id, cp.id, (base*rand(0.95,1.05)).toFixed(2), "USD", "competitor", dt, dt]);
      if (cphRows.length >= 200) await flushCPH();
    }
  }
  await flushCPH();
  console.log(`   ✅ ${cphTotal} competitor prices\n`);

  // ════════════════════════════════════════════════════════════════════
  // 4. Alerts
  // ════════════════════════════════════════════════════════════════════
  console.log("4/7  Alerts");
  const atypes = ["price_drop","price_increase","competitor_change","threshold"];
  const sevs = ["low","medium","medium","medium","high","high","critical"];
  const tBank: Record<string,string[]> = {
    price_drop:["Price dropped on competitor site","Competitor discount detected","Price fell below threshold","Flash sale alert"],
    price_increase:["Competitor raised prices","Market upward shift","Opportunity: competitor hike"],
    competitor_change:["Competitor pricing strategy changed","Matched product price shifted","New competitor pricing"],
    threshold:["Price threshold breached","Margin threshold alert","Floor price warning"],
  };
  const mBank: Record<string,string[]> = {
    price_drop:["Competitor reduced their price significantly.","Price drop detected that may impact market position."],
    price_increase:["Competitor increased pricing, creating opportunity.","Market prices trending upward."],
    competitor_change:["A competitor changed their pricing structure.","New pricing strategy detected."],
    threshold:["Your configured price threshold has been breached.","Price moved outside acceptable range."],
  };

  let ac = 0;
  for (const uid of uids) {
    const ups = byUser[uid] ?? [];
    if (!ups.length) continue;
    for (let i = 0; i < Math.min(15, Math.max(3, Math.floor(ups.length/10))); i++) {
      const p = pick(ups);
      const at = pick([...atypes]); const sev = pick(sevs);
      const price = Number(p.price) || 9.99;
      const isDrop = at==="price_drop" || (at==="threshold" && Math.random()<0.5);
      const tp = (isDrop ? price*rand(0.85,0.97) : price*rand(1.03,1.15)).toFixed(2);
      const dt = new Date(); dt.setDate(dt.getDate()-Math.floor(rand(0,30)));
      try {
        await pool.query(`INSERT INTO alerts (user_id,product_id,alert_type,severity,title,message,trigger_price,trigger_condition,is_read,is_resolved,is_notified,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
          [uid, p.id, at, sev,
           `${pick(tBank[at])}: ${esc(p.title).slice(0,50)}`,
           `${pick(mBank[at])} SKU: ${p.sku??"N/A"}`,
           tp, isDrop?"below":"above",
           Math.random()<0.6, Math.random()<0.4, Math.random()<0.5,
           dt.toISOString()]);
        ac++;
      } catch { /* */ }
    }
  }
  console.log(`   ✅ ${ac} alerts\n`);

  // ════════════════════════════════════════════════════════════════════
  // 5. Recommendations
  // ════════════════════════════════════════════════════════════════════
  console.log("5/7  Recommendations");
  // Query all products that have competitor_products
  const allCP = (await pool.query("SELECT DISTINCT product_id FROM competitor_products WHERE is_active=true")).rows as any[];
  const eligible = [...new Set(allCP.map(c=>c.product_id))];
  const pMap = new Map(prods.map(p=>[p.id,p]));
  let rc = 0;
  for (const pid of eligible) {
    if (Math.random() > 0.45) continue;
    const cmpR = await pool.query("SELECT price FROM competitor_products WHERE product_id=$1 AND is_active=true",[pid]);
    if (!cmpR.rows.length) continue;
    const prices = cmpR.rows.map((r:any)=>Number(r.price));
    const avg = prices.reduce((a,b)=>a+b,0)/prices.length;
    const p = pMap.get(pid); if (!p) continue;
    const cur = Number(p.price);
    let rec: number, reason: string, strat: string;
    if (cur > avg*1.08) { rec=Math.round(avg*0.98*100)/100; strat="price_reduction"; reason=`Your ($${cur}) is ${((cur/avg-1)*100).toFixed(1)}% above avg competitor ($${avg.toFixed(2)}). Lowering improves conversions.`; }
    else if (cur < avg*0.92) { rec=Math.round(avg*0.97*100)/100; strat="price_increase"; reason=`Your ($${cur}) is ${((1-cur/avg)*100).toFixed(1)}% below market. Raising to $${rec.toFixed(2)} increases margins.`; }
    else continue;
    if (Math.abs(rec-cur) < 0.5) continue;
    rec = Math.max(rec, cur*0.85);
    const change = Math.round((rec-cur)*100)/100;
    const chPct = Math.round((change/cur)*100*100)/100;
    const conf = Math.min(0.6+prices.length*0.08, 0.95);
    const r = Math.random();
    const st: string = r<0.6?"pending":r<0.85?"implemented":"dismissed";
    const dt = new Date(); dt.setDate(dt.getDate()-Math.floor(rand(0,21)));
    const sv = Math.abs(change)*rand(10,200);
    const implDays = st==="implemented" ? Math.floor(rand(1,14)) : null;
    try {
      if (st==="implemented") {
        await pool.query(`INSERT INTO recommendations (user_id,product_id,current_price,recommended_price,price_change,price_change_percent,confidence_score,reason,factors,status,potential_savings,implemented_at,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW() - '${implDays} days',$12,$12)`,
          [p.user_id,pid,String(cur),String(rec),String(change),String(chPct),conf.toFixed(3),reason,
           JSON.stringify({competitorCount:prices.length,avgPrice:+avg.toFixed(2),minPrice:+Math.min(...prices).toFixed(2),maxPrice:+Math.max(...prices).toFixed(2),strategy:strat}),
           st,String(+sv.toFixed(2)),dt.toISOString()]);
      } else {
        await pool.query(`INSERT INTO recommendations (user_id,product_id,current_price,recommended_price,price_change,price_change_percent,confidence_score,reason,factors,status,potential_savings,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
          [p.user_id,pid,String(cur),String(rec),String(change),String(chPct),conf.toFixed(3),reason,
           JSON.stringify({competitorCount:prices.length,avgPrice:+avg.toFixed(2),minPrice:+Math.min(...prices).toFixed(2),maxPrice:+Math.max(...prices).toFixed(2),strategy:strat}),
           st,String(+sv.toFixed(2)),dt.toISOString()]);
      }
      rc++;
    } catch { /* */ }
  }
  console.log(`   ✅ ${rc} recommendations\n`);

  // ════════════════════════════════════════════════════════════════════
  // 6. Scrape Jobs
  // ════════════════════════════════════════════════════════════════════
  console.log("6/7  Scrape Jobs");
  let sj = 0;
  const errs = ["Connection timeout","Rate limited (429)","HTML structure change","DNS resolution failed","SSL error"];
  for (const c of comps) {
    for (let i = 0; i < 2+Math.floor(Math.random()*3); i++) {
      const r = Math.random();
      const st = r<0.7?"success":r<0.85?"failed":r<0.95?"running":"pending";
      const sa = new Date(); sa.setDate(sa.getDate()-Math.floor(rand(0,30)));
      const dur = st==="success"?rand(2,15):st==="failed"?rand(1,3):0;
      const ca = st==="success"||st==="failed"?new Date(sa.getTime()+dur*60000):null;
      const sc = st==="success"?Math.floor(rand(50,500)):st==="failed"?Math.floor(rand(0,20)):0;
      try {
        await pool.query(`INSERT INTO scrape_jobs (competitor_id,status,started_at,completed_at,products_scraped,products_updated,error_message,metadata,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$3)`,
          [c.id,st,sa.toISOString(),ca?.toISOString()??null,sc,Math.floor(sc*0.8),
           st==="failed"?pick(errs):null,
           JSON.stringify({method:pick(["web_scrape","api","puppeteer"]),pages:Math.floor(rand(1,20))})]);
        sj++;
      } catch { /* */ }
    }
  }
  console.log(`   ✅ ${sj} scrape jobs\n`);

  // ════════════════════════════════════════════════════════════════════
  // 7. Activity Logs
  // ════════════════════════════════════════════════════════════════════
  console.log("7/7  Activity Logs");
  const actions = ["product.created","product.updated","competitor.added","price.synced","alert.triggered","recommendation.generated","recommendation.implemented","scrape.completed","store.connected","report.exported"];
  const eTypes: Record<string,string> = {product:"product",competitor:"competitor",alert:"alert",recommendation:"recommendation",price:"price",store:"shopify_store",report:"report",scrape:"competitor"};
  let al = 0;
  for (const uid of uids) {
    const ups = byUser[uid] ?? [];
    for (let i = 0; i < 12+Math.floor(Math.random()*15); i++) {
      const act = pick(actions);
      const p = ups.length ? pick(ups) : null;
      const dt = new Date(); dt.setDate(dt.getDate()-Math.floor(rand(0,30))); dt.setHours(Math.floor(rand(8,22)),Math.floor(rand(0,59)));
      try {
        await pool.query(`INSERT INTO activity_logs (user_id,action,entity_type,entity_id,detail,metadata,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [uid,act,eTypes[act.split(".")[0]]??"system",p?.id??null,
           `${act}: ${esc(p?.title?.slice(0,40)??"system")}`,"{}",dt.toISOString()]);
        al++;
      } catch { /* */ }
    }
  }
  console.log(`   ✅ ${al} activity logs\n`);

  // ════════════════════════════════════════════════════════════════════
  // FINAL STATE
  // ════════════════════════════════════════════════════════════════════
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║             FINAL DATABASE STATE                 ║");
  console.log("╠══════════════════════════════════════════════════╣");
  const tables = ["users","shopify_stores","products","competitors","competitor_products","price_history","alerts","recommendations","scrape_jobs","activity_logs","notification_preferences"];
  for (const t of tables) {
    const r = await q(`SELECT count(*)::int FROM ${t}`);
    console.log(`  ${t.padEnd(32)} ${(String((r.rows[0] as any).count)).padStart(7)}`);
  }
  console.log("╚══════════════════════════════════════════════════╝");
  console.log("\n✨ Done! Open http://localhost:3000 to see your data.");
  await pool.end();
}

main().catch(e => { console.error("\n❌ Fatal:", e); process.exit(1); });
