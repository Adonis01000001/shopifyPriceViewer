import { z } from "zod";

/**
 * SKU validation schema.
 * - Optional (empty string → undefined)
 * - Trimmed, uppercased
 * - Max 100 chars
 * - Only letters, numbers, "-", "_", "/"
 */
export const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .max(100, "SKU must be 100 characters or fewer")
  .regex(
    /^[A-Za-z0-9\-_/]*$/,
    "SKU can only contain letters, numbers, -, _ and /"
  )
  .refine(val => val.length === 0 || val.length >= 1, "SKU cannot be empty if provided")
  .optional()
  .transform(val => (val && val.length > 0 ? val : undefined));

/**
 * Product name validation schema.
 * - Required
 * - Trimmed
 * - 2–255 characters
 */
export const productNameSchema = z
  .string()
  .trim()
  .min(2, "Product name must be at least 2 characters")
  .max(255, "Product name must be 255 characters or fewer");

/**
 * Price validation schema.
 * - Required
 * - Positive decimal with up to 2 decimal places
 * - Stored as string (never float)
 */
export const priceSchema = z
  .string()
  .regex(
    /^\d+(\.\d{1,2})?$/,
    "Price must be a positive number with up to 2 decimal places (e.g. 19.99)"
  );

/**
 * Normalize a product name for duplicate comparison.
 * - Trim, lowercase, collapse multiple spaces.
 */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
