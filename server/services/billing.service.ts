import Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { billingEvents, subscriptions, users } from "../../drizzle/schema";
import type { PlanId } from "../../shared/plans";
import { requireDb } from "../_core/db-assert";
import { ENV } from "../_core/env";
import { logger } from "../_core/logger";
import { analyticsService } from "./analytics.service";
import { ensureSubscription } from "./usage.service";

const stripe = ENV.stripeSecretKey ? new Stripe(ENV.stripeSecretKey) : null;
const paidPlans = ["starter", "pro", "scale"] as const;
type PaidPlanId = (typeof paidPlans)[number];

function getStripe(): Stripe {
  if (!stripe) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Billing is not configured for this environment",
    });
  }
  return stripe;
}

function planPriceId(plan: PaidPlanId): string {
  const priceId = ENV.stripePriceIds[plan];
  if (!priceId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Stripe price is not configured for the ${plan} plan`,
    });
  }
  return priceId;
}

function customerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null
): string | null {
  return typeof customer === "string" ? customer : customer?.id ?? null;
}

function subscriptionId(
  subscription: string | Stripe.Subscription | null
): string | null {
  return typeof subscription === "string"
    ? subscription
    : subscription?.id ?? null;
}

function dateFromUnix(value: number | null | undefined): Date | null {
  return typeof value === "number" ? new Date(value * 1000) : null;
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  return subscriptionId(invoice.parent?.subscription_details?.subscription ?? null);
}

function mapStripeStatus(status: Stripe.Subscription.Status) {
  if (status === "trialing") return "trialing" as const;
  if (status === "active") return "active" as const;
  if (status === "past_due") return "past_due" as const;
  return "canceled" as const;
}

function configuredPlanFromPrice(priceId: string | undefined): PlanId | null {
  if (priceId && priceId === ENV.stripePriceIds.starter) return "starter";
  if (priceId && priceId === ENV.stripePriceIds.pro) return "pro";
  if (priceId && priceId === ENV.stripePriceIds.scale) return "scale";
  return null;
}

async function findSubscriptionByProviderId(providerId: string) {
  const database = await requireDb();
  const [row] = await database
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.providerSubscriptionId, providerId))
    .limit(1);
  return row ?? null;
}

async function findSubscriptionByCustomerId(providerCustomerId: string) {
  const database = await requireDb();
  const [row] = await database
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.providerCustomerId, providerCustomerId))
    .limit(1);
  return row ?? null;
}

async function syncStripeSubscription(
  userId: string,
  remote: Stripe.Subscription,
  providerCustomerId: string | null,
  requestedPlan?: PlanId | null
) {
  const database = await requireDb();
  const [current] = await database
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  const priceId = remote.items.data[0]?.price?.id;
  const plan =
    configuredPlanFromPrice(priceId) ??
    requestedPlan ??
    (current?.plan as PlanId | undefined) ??
    "free";
  const values = {
    plan,
    status: mapStripeStatus(remote.status),
    trialEndsAt: dateFromUnix(remote.trial_end),
    currentPeriodEndsAt: dateFromUnix(remote.items.data[0]?.current_period_end),
    cancelAtPeriodEnd: remote.cancel_at_period_end,
    provider: "stripe",
    providerCustomerId,
    providerSubscriptionId: remote.id,
    updatedAt: new Date(),
  } as const;

  if (current) {
    const [updated] = await database
      .update(subscriptions)
      .set(values)
      .where(
        and(eq(subscriptions.id, current.id), eq(subscriptions.userId, userId))
      )
      .returning();
    return updated ?? current;
  }

  const [created] = await database
    .insert(subscriptions)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: subscriptions.userId, set: values })
    .returning();
  return created;
}

async function resolveUserId(
  remote: Stripe.Subscription,
  providerCustomerId: string | null
): Promise<string | null> {
  const metadataUserId = remote.metadata?.userId;
  if (metadataUserId) return metadataUserId;
  const existing = await findSubscriptionByProviderId(remote.id);
  if (existing) return existing.userId;
  if (providerCustomerId) {
    const byCustomer = await findSubscriptionByCustomerId(providerCustomerId);
    return byCustomer?.userId ?? null;
  }
  return null;
}

async function processEvent(event: Stripe.Event) {
  const provider = getStripe();
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const remoteId = subscriptionId(session.subscription);
      if (!remoteId) return;
      const remote = await provider.subscriptions.retrieve(remoteId);
      const userId = session.client_reference_id ?? session.metadata?.userId;
      if (!userId) throw new Error("Checkout session has no application user ID");
      const selectedPlan = (session.metadata?.plan as PlanId | undefined) ?? null;
      await syncStripeSubscription(
        userId,
        remote,
        customerId(session.customer),
        selectedPlan
      );
      await analyticsService
        .track({
          userId,
          eventName: "checkout_completed",
          properties: {
            plan: selectedPlan ?? "unknown",
            provider: "stripe",
          },
        })
        .catch(error =>
          logger.warn({ err: error, userId }, "Checkout analytics event failed")
        );
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const remote = event.data.object as Stripe.Subscription;
      const providerCustomerId = customerId(remote.customer);
      const userId = await resolveUserId(remote, providerCustomerId);
      if (!userId) {
        logger.warn(
          { eventId: event.id, subscriptionId: remote.id },
          "Stripe subscription is not linked to an application user"
        );
        return;
      }
      await syncStripeSubscription(userId, remote, providerCustomerId);
      return;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const remoteId = invoiceSubscriptionId(invoice);
      if (!remoteId) return;
      const existing = await findSubscriptionByProviderId(remoteId);
      if (!existing) return;
      const database = await requireDb();
      await database
        .update(subscriptions)
        .set({ status: "past_due", updatedAt: new Date() })
        .where(eq(subscriptions.id, existing.id));
      return;
    }
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const remoteId = invoiceSubscriptionId(invoice);
      if (!remoteId) return;
      const remote = await provider.subscriptions.retrieve(remoteId);
      const providerCustomerId = customerId(remote.customer);
      const userId = await resolveUserId(remote, providerCustomerId);
      if (userId) await syncStripeSubscription(userId, remote, providerCustomerId);
      return;
    }
    default:
      return;
  }
}

export const billingService = {
  isConfigured: Boolean(stripe),

  async getSubscription(userId: string) {
    const database = await requireDb();
    const subscription = await ensureSubscription(database, userId);
    return {
      plan: subscription.plan,
      status: subscription.status,
      trialEndsAt: subscription.trialEndsAt,
      currentPeriodEndsAt: subscription.currentPeriodEndsAt,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      provider: subscription.provider,
      hasProviderSubscription: Boolean(subscription.providerSubscriptionId),
    };
  },

  async createCheckoutSession(userId: string, plan: PaidPlanId) {
    const provider = getStripe();
    const database = await requireDb();
    const current = await ensureSubscription(database, userId);
    if (
      current.providerSubscriptionId &&
      ["trialing", "active", "past_due"].includes(current.status)
    ) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Use the billing portal to change an existing subscription",
      });
    }
    const [user] = await database
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const customer = current.providerCustomerId
      ? current.providerCustomerId
      : await provider.customers.create({
          email: user?.email ?? undefined,
          metadata: { userId },
        });
    const providerCustomerId = customerId(customer);
    if (!providerCustomerId) throw new Error("Stripe did not return a customer ID");
    await database
      .update(subscriptions)
      .set({ provider: "stripe", providerCustomerId, updatedAt: new Date() })
      .where(eq(subscriptions.id, current.id));

    const session = await provider.checkout.sessions.create({
      mode: "subscription",
      customer: providerCustomerId,
      client_reference_id: userId,
      line_items: [{ price: planPriceId(plan), quantity: 1 }],
      metadata: { userId, plan },
      subscription_data: { metadata: { userId, plan } },
      success_url: `${ENV.appUrl}/dashboard/settings?billing=success`,
      cancel_url: `${ENV.appUrl}/dashboard/settings?billing=cancelled`,
      allow_promotion_codes: true,
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return { url: session.url };
  },

  async createPortalSession(userId: string) {
    const provider = getStripe();
    const database = await requireDb();
    const current = await ensureSubscription(database, userId);
    if (!current.providerCustomerId) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No billing customer exists for this account yet",
      });
    }
    const session = await provider.billingPortal.sessions.create({
      customer: current.providerCustomerId,
      return_url: `${ENV.appUrl}/dashboard/settings`,
    });
    return { url: session.url };
  },

  async changePlan(userId: string, plan: PaidPlanId) {
    const provider = getStripe();
    const database = await requireDb();
    const current = await ensureSubscription(database, userId);
    if (!current.providerSubscriptionId) {
      return billingService.createCheckoutSession(userId, plan);
    }
    const remote = await provider.subscriptions.retrieve(current.providerSubscriptionId);
    const item = remote.items.data[0];
    if (!item) throw new Error("Stripe subscription has no billable item");
    const updated = await provider.subscriptions.update(remote.id, {
      items: [{ id: item.id, price: planPriceId(plan) }],
      proration_behavior: "create_prorations",
      metadata: { userId, plan },
    });
    await syncStripeSubscription(userId, updated, customerId(updated.customer), plan);
    return { updated: true };
  },

  async cancelSubscription(userId: string, cancelAtPeriodEnd: boolean) {
    const provider = getStripe();
    const database = await requireDb();
    const current = await ensureSubscription(database, userId);
    if (!current.providerSubscriptionId) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No active billing subscription",
      });
    }
    const remote = await provider.subscriptions.update(current.providerSubscriptionId, {
      cancel_at_period_end: cancelAtPeriodEnd,
    });
    await syncStripeSubscription(userId, remote, customerId(remote.customer));
    return { cancelAtPeriodEnd: remote.cancel_at_period_end };
  },

  async handleWebhook(rawBody: Buffer, signature: string) {
    const provider = getStripe();
    if (!ENV.stripeWebhookSecret) {
      throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
    }
    const event = provider.webhooks.constructEvent(
      rawBody,
      signature,
      ENV.stripeWebhookSecret
    );
    const database = await requireDb();
    const payload = JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
    const [claimed] = await database
      .insert(billingEvents)
      .values({
        stripeEventId: event.id,
        eventType: event.type,
        livemode: event.livemode,
        payload,
      })
      .onConflictDoNothing({ target: billingEvents.stripeEventId })
      .returning({ id: billingEvents.id, status: billingEvents.status });

    if (!claimed) {
      const [existing] = await database
        .select({ id: billingEvents.id, status: billingEvents.status })
        .from(billingEvents)
        .where(eq(billingEvents.stripeEventId, event.id))
        .limit(1);
      if (existing?.status === "processed" || existing?.status === "processing") {
        return { received: true, duplicate: true };
      }
      if (existing) {
        await database
          .update(billingEvents)
          .set({ status: "processing", errorMessage: null })
          .where(eq(billingEvents.id, existing.id));
      }
    }

    const eventRowId = claimed?.id;
    try {
      await processEvent(event);
      const rowId =
        eventRowId ??
        (
          await database
            .select({ id: billingEvents.id })
            .from(billingEvents)
            .where(eq(billingEvents.stripeEventId, event.id))
            .limit(1)
        )[0]?.id;
      if (rowId) {
        await database
          .update(billingEvents)
          .set({ status: "processed", processedAt: new Date(), errorMessage: null })
          .where(eq(billingEvents.id, rowId));
      }
      return { received: true, duplicate: false };
    } catch (error) {
      const rowId =
        eventRowId ??
        (
          await database
            .select({ id: billingEvents.id })
            .from(billingEvents)
            .where(eq(billingEvents.stripeEventId, event.id))
            .limit(1)
        )[0]?.id;
      if (rowId) {
        await database
          .update(billingEvents)
          .set({
            status: "failed",
            errorMessage:
              error instanceof Error ? error.message : "Unknown billing event error",
          })
          .where(eq(billingEvents.id, rowId));
      }
      throw error;
    }
  },
};
