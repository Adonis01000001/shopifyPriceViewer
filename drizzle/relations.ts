import { relations } from "drizzle-orm";
import {
  users,
  subscriptions,
  billingEvents,
  reportRuns,
  notificationDeliveries,
  emailConfigs,
  notificationPreferences,
  shopifyStores,
  products,
  productEmbeddings,
  competitors,
  competitorProducts,
  priceHistory,
  alerts,
  recommendations,
  scrapeJobs,
  activityLogs,
} from "./schema";

export const usersRelations = relations(users, ({ many, one }) => ({
  subscription: one(subscriptions),
  reportRuns: many(reportRuns),
  notificationDeliveries: many(notificationDeliveries),
  emailConfigs: many(emailConfigs),
  notificationPreferences: many(notificationPreferences),
  shopifyStores: many(shopifyStores),
  products: many(products),
  competitors: many(competitors),
  alerts: many(alerts),
  recommendations: many(recommendations),
  activityLogs: many(activityLogs),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, {
    fields: [subscriptions.userId],
    references: [users.id],
  }),
}));

export const billingEventsRelations = relations(billingEvents, () => ({}));

export const reportRunsRelations = relations(reportRuns, ({ one, many }) => ({
  user: one(users, {
    fields: [reportRuns.userId],
    references: [users.id],
  }),
  deliveries: many(notificationDeliveries),
}));

export const notificationDeliveriesRelations = relations(
  notificationDeliveries,
  ({ one }) => ({
    user: one(users, {
      fields: [notificationDeliveries.userId],
      references: [users.id],
    }),
    reportRun: one(reportRuns, {
      fields: [notificationDeliveries.reportRunId],
      references: [reportRuns.id],
    }),
  })
);

export const emailConfigsRelations = relations(emailConfigs, ({ one }) => ({
  user: one(users, {
    fields: [emailConfigs.userId],
    references: [users.id],
  }),
}));

export const notificationPreferencesRelations = relations(
  notificationPreferences,
  ({ one }) => ({
    user: one(users, {
      fields: [notificationPreferences.userId],
      references: [users.id],
    }),
  })
);

export const shopifyStoresRelations = relations(
  shopifyStores,
  ({ one, many }) => ({
    user: one(users, {
      fields: [shopifyStores.userId],
      references: [users.id],
    }),
    products: many(products),
  })
);

export const productsRelations = relations(products, ({ one, many }) => ({
  user: one(users, {
    fields: [products.userId],
    references: [users.id],
  }),
  store: one(shopifyStores, {
    fields: [products.storeId],
    references: [shopifyStores.id],
  }),
  embedding: one(productEmbeddings),
  competitorProducts: many(competitorProducts),
  priceHistory: many(priceHistory),
  alerts: many(alerts),
  recommendations: many(recommendations),
}));

export const productEmbeddingsRelations = relations(
  productEmbeddings,
  ({ one }) => ({
    product: one(products, {
      fields: [productEmbeddings.productId],
      references: [products.id],
    }),
  })
);

export const competitorsRelations = relations(competitors, ({ one, many }) => ({
  user: one(users, {
    fields: [competitors.userId],
    references: [users.id],
  }),
  competitorProducts: many(competitorProducts),
  scrapeJobs: many(scrapeJobs),
}));

export const competitorProductsRelations = relations(
  competitorProducts,
  ({ one, many }) => ({
    competitor: one(competitors, {
      fields: [competitorProducts.competitorId],
      references: [competitors.id],
    }),
    product: one(products, {
      fields: [competitorProducts.productId],
      references: [products.id],
    }),
    priceHistory: many(priceHistory),
    alerts: many(alerts),
  })
);

export const priceHistoryRelations = relations(priceHistory, ({ one }) => ({
  product: one(products, {
    fields: [priceHistory.productId],
    references: [products.id],
  }),
  competitorProduct: one(competitorProducts, {
    fields: [priceHistory.competitorProductId],
    references: [competitorProducts.id],
  }),
}));

export const alertsRelations = relations(alerts, ({ one }) => ({
  user: one(users, {
    fields: [alerts.userId],
    references: [users.id],
  }),
  product: one(products, {
    fields: [alerts.productId],
    references: [products.id],
  }),
  competitorProduct: one(competitorProducts, {
    fields: [alerts.competitorProductId],
    references: [competitorProducts.id],
  }),
}));

export const recommendationsRelations = relations(
  recommendations,
  ({ one }) => ({
    user: one(users, {
      fields: [recommendations.userId],
      references: [users.id],
    }),
    product: one(products, {
      fields: [recommendations.productId],
      references: [products.id],
    }),
  })
);

export const scrapeJobsRelations = relations(scrapeJobs, ({ one }) => ({
  competitor: one(competitors, {
    fields: [scrapeJobs.competitorId],
    references: [competitors.id],
  }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  user: one(users, {
    fields: [activityLogs.userId],
    references: [users.id],
  }),
}));




// Aggregate relations object passed to drizzle() so the relational query
// builder (db.query.<table>) is typed. Table keys must match the table
// names Drizzle infers from pgTable calls in schema.ts.
export const dbRelations = {
  users: usersRelations,
  subscriptions: subscriptionsRelations,
  billingEvents: billingEventsRelations,
  reportRuns: reportRunsRelations,
  notificationDeliveries: notificationDeliveriesRelations,
  emailConfigs: emailConfigsRelations,
  notificationPreferences: notificationPreferencesRelations,
  shopifyStores: shopifyStoresRelations,
  products: productsRelations,
  productEmbeddings: productEmbeddingsRelations,
  competitors: competitorsRelations,
  competitorProducts: competitorProductsRelations,
  priceHistory: priceHistoryRelations,
  alerts: alertsRelations,
  recommendations: recommendationsRelations,
  scrapeJobs: scrapeJobsRelations,
  activityLogs: activityLogsRelations,
} as const;
