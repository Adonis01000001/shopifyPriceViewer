import { z } from "zod";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requireDb } from "../_core/db-assert";
import { activityLogs, accountShopConnections, products } from "../../drizzle/schema";
import { PIPELINE_ACTIONS } from "../services/pipeline.service";

const EVENT_LIMIT = 40;
// A 29-product run writes a few thousand step rows. The panel only ever shows
// the tail, so read a window rather than the lot.
const STEP_LIMIT = 60;
// A run that is killed mid-flight never writes its finish, which would leave
// the indicator claiming to be working forever. Each product takes about a
// minute and a half, so silence for this long means the run is gone.
const STALE_AFTER_MS = 10 * 60 * 1000;

type Meta = Record<string, unknown> | null;

function num(meta: Meta, key: string): number | null {
  const value = meta?.[key];
  return typeof value === "number" ? value : null;
}

export const pipelineRouter = router({
  /**
   * Drives the activity indicator. The pipeline writes one row per step, so
   * the current state is derived from those rows rather than from memory —
   * that way it still reports correctly when the run happens in the worker
   * process rather than this one.
   */
  status: protectedProcedure
    .input(z.object({ storeId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
    const database = await requireDb();
    const userId = ctx.user!.id;
    if (input?.storeId) {
      const [connection] = await database
        .select({ id: accountShopConnections.id })
        .from(accountShopConnections)
        .where(and(eq(accountShopConnections.id, input.storeId), eq(accountShopConnections.userId, userId), eq(accountShopConnections.isActive, true)))
        .limit(1);
      if (!connection) return { running: false, startedAt: null, total: 0, done: 0, current: null, steps: [], events: [], lastRun: null };
    }

    const bookends = await database
      .select({
        action: activityLogs.action,
        detail: activityLogs.detail,
        metadata: activityLogs.metadata,
        createdAt: activityLogs.createdAt,
      })
      .from(activityLogs)
      .where(
        and(
          eq(activityLogs.userId, userId),
          inArray(activityLogs.action, [
            PIPELINE_ACTIONS.runStarted,
            PIPELINE_ACTIONS.runFinished,
          ])
        )
      )
      .orderBy(desc(activityLogs.createdAt))
      .limit(2);

    const started = bookends.find(r => r.action === PIPELINE_ACTIONS.runStarted);
    const finished = bookends.find(
      r => r.action === PIPELINE_ACTIONS.runFinished
    );

    const lastActivity = started
      ? await database
          .select({ createdAt: activityLogs.createdAt })
          .from(activityLogs)
          .where(
            and(
              eq(activityLogs.userId, userId),
              gte(activityLogs.createdAt, started.createdAt)
            )
          )
          .orderBy(desc(activityLogs.createdAt))
          .limit(1)
      : [];

    const wentQuietAt = lastActivity[0]?.createdAt ?? started?.createdAt;
    const isStale =
      !!wentQuietAt && Date.now() - wentQuietAt.getTime() > STALE_AFTER_MS;

    const running =
      !!started &&
      (!finished ||
        finished.createdAt.getTime() < started.createdAt.getTime()) &&
      !isStale;

    const events = started
      ? await database
          .select({
            action: activityLogs.action,
            detail: activityLogs.detail,
            metadata: activityLogs.metadata,
            createdAt: activityLogs.createdAt,
          })
          .from(activityLogs)
          .where(
            and(
              eq(activityLogs.userId, userId),
              gte(activityLogs.createdAt, started.createdAt),
              inArray(activityLogs.action, [
                PIPELINE_ACTIONS.productStarted,
                PIPELINE_ACTIONS.productDone,
              ])
            )
          )
          .orderBy(desc(activityLogs.createdAt))
          .limit(EVENT_LIMIT)
      : [];

    const doneIds = new Set<string>();
    for (const event of events) {
      if (event.action === PIPELINE_ACTIONS.productDone && event.detail) {
        doneIds.add(event.detail);
      }
    }

    // Newest first, so the first started-but-not-done product is the live one.
    const current =
      running &&
      events.find(
        e =>
          e.action === PIPELINE_ACTIONS.productStarted &&
          e.detail &&
          !doneIds.has(e.detail)
      )?.detail;

    const steps = started
      ? await database
          .select({
            detail: activityLogs.detail,
            createdAt: activityLogs.createdAt,
          })
          .from(activityLogs)
          .where(
            and(
              eq(activityLogs.userId, userId),
              gte(activityLogs.createdAt, started.createdAt),
              eq(activityLogs.action, PIPELINE_ACTIONS.productStep)
            )
          )
          .orderBy(desc(activityLogs.createdAt))
          .limit(STEP_LIMIT)
      : [];

    const startedMeta = started?.metadata as Meta;
    const finishedMeta = finished?.metadata as Meta;

    return {
      running,
      startedAt: started?.createdAt ?? null,
      total: num(startedMeta, "total") ?? 0,
      done: doneIds.size,
      current: current || null,
      steps: steps.map(e => ({ detail: e.detail ?? "", at: e.createdAt })),
      events: events
        .filter(e => e.action === PIPELINE_ACTIONS.productDone)
        .slice(0, 12)
        .map(e => {
          const meta = e.metadata as Meta;
          return {
            title: e.detail ?? "",
            at: e.createdAt,
            matched: num(meta, "matched") ?? 0,
            recommendedPrice: num(meta, "recommendedPrice"),
            marginProtectionApplied: meta?.marginProtectionApplied === true,
            skipped: typeof meta?.skipped === "string" ? meta.skipped : null,
            failed: meta?.failed === true,
          };
        }),
      lastRun: finished
        ? {
            finishedAt: finished.createdAt,
            durationMs: num(finishedMeta, "durationMs") ?? 0,
            products: num(finishedMeta, "products") ?? 0,
            matched: num(finishedMeta, "matched") ?? 0,
            recommended: num(finishedMeta, "recommended") ?? 0,
          }
        : null,
    };
  }),

  /**
   * What became of each product the last time it was checked. Without this a
   * product with no recommendation just shows a dash, and the reason — which
   * the run already recorded — is only visible in the activity panel.
   */
  productOutcomes: protectedProcedure
    .input(z.object({ storeId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
    const database = await requireDb();

    const rows = await database
      .select({
        productId: activityLogs.entityId,
        metadata: activityLogs.metadata,
        createdAt: activityLogs.createdAt,
      })
      .from(activityLogs)
      .where(
        and(
          eq(activityLogs.userId, ctx.user!.id),
          eq(activityLogs.action, PIPELINE_ACTIONS.productDone)
          ,input?.storeId
            ? inArray(
                activityLogs.entityId,
                database.select({ id: products.id }).from(products).where(eq(products.storeId, input.storeId))
              )
            : undefined
        )
      )
      .orderBy(desc(activityLogs.createdAt))
      .limit(400);

    // Newest first, so the first row seen for a product is its latest pass.
    const latest = new Map<
      string,
      { checkedAt: Date; matched: number; skipped: string | null; failed: boolean }
    >();
    for (const row of rows) {
      if (!row.productId || latest.has(row.productId)) continue;
      const meta = row.metadata as Meta;
      latest.set(row.productId, {
        checkedAt: row.createdAt,
        matched: num(meta, "matched") ?? 0,
        skipped: typeof meta?.skipped === "string" ? meta.skipped : null,
        failed: meta?.failed === true,
      });
    }

    return Object.fromEntries(latest);
  }),

  /**
   * Every shop the last run looked at for one product, and what came of each.
   * The run already narrates itself step by step; this reads that narration
   * back so a merchant can see the working rather than only the verdict.
   */
  productEvidence: protectedProcedure
    .input(z.object({ productId: z.string().uuid(), storeId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const database = await requireDb();
      if (input.storeId) {
        const [ownedProduct] = await database
          .select({ id: products.id })
          .from(products)
          .innerJoin(accountShopConnections, eq(products.storeId, accountShopConnections.id))
          .where(and(eq(products.id, input.productId), eq(products.storeId, input.storeId), eq(products.userId, ctx.user!.id), eq(accountShopConnections.isActive, true)))
          .limit(1);
        if (!ownedProduct) throw new Error("Product not found");
      }

      const rows = await database
        .select({
          detail: activityLogs.detail,
          createdAt: activityLogs.createdAt,
        })
        .from(activityLogs)
        .where(
          and(
            eq(activityLogs.userId, ctx.user!.id),
            eq(activityLogs.entityId, input.productId),
            eq(activityLogs.action, PIPELINE_ACTIONS.productStep)
          )
        )
        .orderBy(desc(activityLogs.createdAt))
        .limit(200);

      // Newest first. Each pass opens with the market line, so everything up
      // to and including the first one found is the most recent pass.
      const latest: typeof rows = [];
      for (const row of rows) {
        latest.push(row);
        if (row.detail?.startsWith("Searching the ")) break;
      }
      latest.reverse();

      return {
        checkedAt: latest[latest.length - 1]?.createdAt ?? null,
        steps: latest.map(r => ({ detail: r.detail ?? "", at: r.createdAt })),
      };
    }),
});
