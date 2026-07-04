# Manual Product Entry Without Shopify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to add products manually without requiring a Shopify store connection.

**Architecture:** Make `storeId` nullable in the products table, update backend validation to allow products without a store, and update frontend to auto-create a "Manual" store when needed.

**Tech Stack:** Drizzle ORM (Postgres), tRPC, React, TypeScript, shadcn/ui

---

## Current State Analysis

- Products table requires `storeId` (non-nullable, foreign key to shopifyStores)
- AddProductDialog shows a "Store" dropdown that must be selected
- Users cannot add products if they haven't connected Shopify yet

---

## Task Breakdown

### Task 1: Make storeId nullable in products schema

**Files:**
- Modify: `drizzle/schema.ts:224-226`

- [ ] **Step 1: Update schema to allow nullable storeId**

```typescript
// Change from:
storeId: uuid("store_id")
  .notNull()
  .references(() => shopifyStores.id, { onDelete: "cascade" }),

// To:
storeId: uuid("store_id").references(() => shopifyStores.id, { onDelete: "set null" }),
```

- [ ] **Step 2: Run migration**

Run: `pnpm db:push`

- [ ] **Step 3: Commit**

```bash
git add drizzle/schema.ts
git commit -m "feat: make storeId nullable for manual products without Shopify"
```

---

### Task 2: Update product router to allow optional storeId

**Files:**
- Modify: `server/routers/product.router.ts:50`

- [ ] **Step 1: Update create procedure input validation**

```typescript
// Line 50: Change from
storeId: z.string().uuid(),
// To:
storeId: z.string().uuid().optional(),
```

- [ ] **Step 2: Add helper function for getting/creating manual store**

Add after the input validation (around line 87):

```typescript
      // For manual products, use or create a "Manual" store placeholder
      let resolvedStoreId = input.storeId;
      if (!resolvedStoreId) {
        const database = await db.getDb();
        if (!database) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }
        
        // Look for existing manual store for this user
        let manualStore = await database.query.shopifyStores.findFirst({
          where: and(
            eq(shopifyStores.userId, ctx.user!.id),
            eq(shopifyStores.storeName, "Manual")
          ),
        });
        
        if (!manualStore) {
          // Create a placeholder manual store
          const result = await database
            .insert(shopifyStores)
            .values({
              userId: ctx.user!.id,
              shopDomain: `manual-${ctx.user!.id.slice(0, 8)}`,
              storeName: "Manual",
              currency: "USD",
              isActive: true,
              scopes: "manual",
            })
            .returning();
          manualStore = result[0];
        }
        
        resolvedStoreId = manualStore.id;
      }
```

- [ ] **Step 3: Update create call to use resolvedStoreId**

```typescript
// Line 71: Change from
storeId: input.storeId,
// To:
storeId: resolvedStoreId!,
```

- [ ] **Step 4: Run type check**

Run: `pnpm check`

- [ ] **Step 5: Commit**

```bash
git add server/routers/product.router.ts
git commit -m "feat: auto-create manual store for products without Shopify storeId"
```

---

### Task 3: Update AddProductDialog frontend

**Files:**
- Modify: `client/src/pages/dashboard/AddProductDialog.tsx`

- [ ] **Step 1: Remove storeId guard from single submit**

Remove lines 206-209:
```typescript
if (!storeId) {
  setSingleError("Please select a store");
  return;
}
```

- [ ] **Step 2: Update single submit to handle no store**

Change lines 211-217 to auto-create placeholder when no store:

```typescript
setSingleSubmitting(true);
createProduct.mutate({
  storeId: storeId || undefined, // Pass undefined if no store - backend will create "Manual"
  title: trimmedName,
  sku: trimmedSku || undefined,
  price: trimmedPrice,
});
```

- [ ] **Step 3: Add message for no stores**

Add after the store selector (around line 349):

```tsx
{stores && stores.length === 0 && (
  <p className="text-sm text-muted-foreground mt-2">
    No Shopify stores connected. Products will be saved to a manual store.
  </p>
)}
```

- [ ] **Step 4: Update bulk submit to handle no store**

For bulk, we can either disable it or auto-assign to Manual store. Let's warn:

Add inside handleSubmit (around line 221):

```typescript
if (!storeId && products.some(p => p.title.trim())) {
  toast.message("Products will be saved to a manual store (no Shopify connected)");
}
```

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/dashboard/AddProductDialog.tsx
git commit -m "feat: enable manual product entry without store selection"
```

---

### Task 4: Add/update tests

**Files:**
- Check: `server/__tests__/` or similar

- [ ] **Step 1: Check test structure**

Run: `ls -la server/__tests__ 2>/dev/null || echo "No __tests__ dir"`

- [ ] **Step 2: Run tests**

Run: `pnpm test`

- [ ] **Step 3: Commit test changes if any**

---

## Verification

After implementation:
1. Open dev server (`pnpm dev`)
2. Navigate to Products page
3. Click "Add Products" 
4. Fill in product form WITHOUT selecting a store
5. Click "Add" - product should be created successfully
6. Check that a "Manual" store was auto-created