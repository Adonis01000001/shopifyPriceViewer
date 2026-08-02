import { relations } from "drizzle-orm";
import {
  users,
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
  scoopSearches,
  scoopSearchResults,
  scoopCompetitorProducts,
} from "./schema";

export const usersRelations = relations(users, ({ many }) => ({
  emailConfigs: many(emailConfigs),
  notificationPreferences: many(notificationPreferences),
  shopifyStores: many(shopifyStores),
  products: many(products),
  competitors: many(competitors),
  alerts: many(alerts),
  recommendations: many(recommendations),
  activityLogs: many(activityLogs),
  scoopSearches: many(scoopSearches),
  scoopSearchResults: many(scoopSearchResults),
  scoopCompetitorProducts: many(scoopCompetitorProducts),
}));

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
    scoopSearchResults: many(scoopSearchResults),
    scoopCompetitorProducts: many(scoopCompetitorProducts),
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

export const scoopSearchesRelations = relations(
  scoopSearches,
  ({ one, many }) => ({
    user: one(users, {
      fields: [scoopSearches.userId],
      references: [users.id],
    }),
    results: many(scoopSearchResults),
  })
);

export const scoopSearchResultsRelations = relations(
  scoopSearchResults,
  ({ one }) => ({
    search: one(scoopSearches, {
      fields: [scoopSearchResults.searchId],
      references: [scoopSearches.id],
    }),
    competitor: one(competitors, {
      fields: [scoopSearchResults.competitorId],
      references: [competitors.id],
    }),
    user: one(users, {
      fields: [scoopSearchResults.userId],
      references: [users.id],
    }),
  })
);

export const scoopCompetitorProductsRelations = relations(
  scoopCompetitorProducts,
  ({ one }) => ({
    competitor: one(competitors, {
      fields: [scoopCompetitorProducts.competitorId],
      references: [competitors.id],
    }),
    user: one(users, {
      fields: [scoopCompetitorProducts.userId],
      references: [users.id],
    }),
    latestSearch: one(scoopSearches, {
      fields: [scoopCompetitorProducts.latestSearchId],
      references: [scoopSearches.id],
    }),
  })
);

// Aggregate relations object passed to drizzle() so the relational query
// builder (db.query.<table>) is typed. Table keys must match the table
// names Drizzle infers from pgTable calls in schema.ts.
export const dbRelations = {
  users: usersRelations,
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
  scoopSearches: scoopSearchesRelations,
  scoopSearchResults: scoopSearchResultsRelations,
  scoopCompetitorProducts: scoopCompetitorProductsRelations,
} as const;
