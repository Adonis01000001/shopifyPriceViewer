import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { requireDb } from "../_core/db-assert";
import type { AppDatabase } from "../db";
import {
  alerts,
  competitorProducts,
  competitors,
  priceChanges,
  products,
  recommendations,
  subscriptions,
  accountCompetitorConnections,
} from "../../drizzle/schema";
import { getPlanDefinition, type PlanId } from "../../shared/plans";

async function countRows(
  query: Promise<Array<{ count: number | string }>>
): Promise<number> {
  const result = await query;
  return Number(result[0]?.count ?? 0);
}

export async function ensureSubscription(database: AppDatabase, userId: string) {
  const existing = await database
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  const current = existing[0];
  const now = new Date();

  if (
    current?.status === "trialing" &&
    current.trialEndsAt &&
    current.trialEndsAt <= now
  ) {
    const [expired] = await database
      .update(subscriptions)
      .set({ plan: "free", status: "active", updatedAt: now })
      .where(
        and(
          eq(subscriptions.id, current.id),
          eq(subscriptions.status, "trialing")
        )
      )
      .returning();
    return expired ?? current;
  }

  if (current) return current;

  const trialEndsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const [created] = await database
    .insert(subscriptions)
    .values({
      userId,
      plan: "pro",
      status: "trialing",
      trialEndsAt,
    })
    .onConflictDoNothing({ target: subscriptions.userId })
    .returning();
  if (created) return created;

  const [raced] = await database
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  if (!raced) throw new Error("Unable to initialize subscription");
  return raced;
}

export const usageService = {
  async getAccountUsage(userId: string) {
    const database = await requireDb();
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const subscription = await ensureSubscription(database, userId);

    const [
      productCount,
      competitorCount,
      alertCount,
      aiRunCount,
      matchCount,
      monthlyChangeCount,
    ] = await Promise.all([
      countRows(
        database
          .select({ count: sql<number>`count(*)::int` })
          .from(products)
          .where(and(eq(products.userId, userId), eq(products.isActive, true)))
      ),
      countRows(
        database
          .select({ count: sql<number>`count(*)::int` })
          .from(competitors)
          .where(
            and(
              inArray(
                competitors.id,
                database
                  .select({ id: accountCompetitorConnections.competitorId })
                  .from(accountCompetitorConnections)
                  .where(
                    and(
                      eq(accountCompetitorConnections.userId, userId),
                      eq(accountCompetitorConnections.isActive, true)
                    )
                  )
              ),
              eq(competitors.status, "active")
            )
          )
      ),
      countRows(
        database
          .select({ count: sql<number>`count(*)::int` })
          .from(alerts)
          .where(and(eq(alerts.userId, userId), gte(alerts.createdAt, since)))
      ),
      countRows(
        database
          .select({ count: sql<number>`count(*)::int` })
          .from(recommendations)
          .where(
            and(
              eq(recommendations.userId, userId),
              gte(recommendations.createdAt, since)
            )
          )
      ),
      countRows(
        database
          .select({ count: sql<number>`count(*)::int` })
          .from(competitorProducts)
          .innerJoin(
            competitors,
            eq(competitorProducts.competitorId, competitors.id)
          )
          .where(
            and(
              inArray(
                competitors.id,
                database
                  .select({ id: accountCompetitorConnections.competitorId })
                  .from(accountCompetitorConnections)
                  .where(
                    and(
                      eq(accountCompetitorConnections.userId, userId),
                      eq(accountCompetitorConnections.isActive, true)
                    )
                  )
              ),
              eq(competitorProducts.isActive, true)
            )
          )
      ),
      countRows(
        database
          .select({ count: sql<number>`count(*)::int` })
          .from(priceChanges)
          .innerJoin(
            competitorProducts,
            eq(priceChanges.competitorProductId, competitorProducts.id)
          )
          .innerJoin(
            competitors,
            eq(competitorProducts.competitorId, competitors.id)
          )
          .where(
            and(
              inArray(
                competitors.id,
                database
                  .select({ id: accountCompetitorConnections.competitorId })
                  .from(accountCompetitorConnections)
                  .where(
                    and(
                      eq(accountCompetitorConnections.userId, userId),
                      eq(accountCompetitorConnections.isActive, true)
                    )
                  )
              ),
              gte(priceChanges.detectedAt, since)
            )
          )
      ),
    ]);

    const planId = subscription.plan as PlanId;
    const plan = getPlanDefinition(planId);
    const usage = {
      products: productCount,
      competitors: competitorCount,
      competitorMatches: matchCount,
      monthlyChanges: monthlyChangeCount,
      alertsMonthly: alertCount,
      aiRunsMonthly: aiRunCount,
    };
    const limits = {
      products: plan.limits.products,
      competitors: plan.limits.competitors,
      monthlyChanges: plan.limits.monthlyChanges,
      alertsMonthly: plan.limits.alertsMonthly,
      aiRunsMonthly: plan.limits.aiRunsMonthly,
    };

    return {
      plan,
      subscription: {
        plan: subscription.plan,
        status: subscription.status,
        trialEndsAt: subscription.trialEndsAt,
        currentPeriodEndsAt: subscription.currentPeriodEndsAt,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      },
      usage,
      limits,
      utilization: {
        products: limits.products ? productCount / limits.products : 0,
        competitors: limits.competitors
          ? competitorCount / limits.competitors
          : 0,
        monthlyChanges: limits.monthlyChanges
          ? monthlyChangeCount / limits.monthlyChanges
          : 0,
        alertsMonthly: limits.alertsMonthly
          ? alertCount / limits.alertsMonthly
          : 0,
        aiRunsMonthly: limits.aiRunsMonthly
          ? aiRunCount / limits.aiRunsMonthly
          : 0,
      },
    };
  },
};
