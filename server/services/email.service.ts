/**
 * Email configuration service.
 * IMPORTANT: smtpPassword is stored AES-256-CBC encrypted in the database.
 * Always use encryptToken() before storing and decryptToken() when reading.
 */
import { eq } from "drizzle-orm";
import { requireDb } from "../_core/db-assert";
import {
  emailConfigs,
  type EmailConfig,
  type InsertEmailConfig,
} from "../../drizzle/schema";
import { encryptToken, decryptToken } from "../_core/sdk";

export const emailService = {
  async getByUserId(
    userId: string
  ): Promise<
    (Omit<EmailConfig, "smtpPassword"> & { smtpPassword: string }) | undefined
  > {
    const database = await requireDb();
    const result = await database
      .select()
      .from(emailConfigs)
      .where(eq(emailConfigs.userId, userId))
      .limit(1);
    if (!result[0]) return undefined;
    return {
      ...result[0],
      smtpPassword: result[0].smtpPassword
        ? decryptToken(result[0].smtpPassword)
        : "",
    };
  },

  async upsert(data: InsertEmailConfig): Promise<EmailConfig> {
    const database = await requireDb();
    const encrypted = {
      ...data,
      smtpPassword: encryptToken(data.smtpPassword),
    };
    const existing = await database
      .select({ id: emailConfigs.id })
      .from(emailConfigs)
      .where(eq(emailConfigs.userId, data.userId))
      .limit(1);

    if (existing[0]) {
      const result = await database
        .update(emailConfigs)
        .set({ ...encrypted, updatedAt: new Date() })
        .where(eq(emailConfigs.userId, data.userId))
        .returning();
      return result[0];
    }

    const result = await database
      .insert(emailConfigs)
      .values(encrypted)
      .returning();
    return result[0];
  },

  async delete(userId: string): Promise<void> {
    const database = await requireDb();
    await database.delete(emailConfigs).where(eq(emailConfigs.userId, userId));
  },
};
