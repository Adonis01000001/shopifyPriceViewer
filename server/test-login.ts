import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import * as schema from "../drizzle/schema";
import bcrypt from "bcrypt";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool, schema });

async function main() {
  try {
    // Step 1: Find user
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, "admin@example.com"))
      .limit(1);

    console.log("User found:", user ? user.email : "NOT FOUND");

    if (!user || !user.passwordHash) {
      console.log("No user or no password hash");
      await pool.end();
      return;
    }

    // Step 2: Verify password
    const isValid = await bcrypt.compare("admin123", user.passwordHash);
    console.log("Password valid:", isValid);

    if (!isValid) {
      console.log("Invalid password");
      await pool.end();
      return;
    }

    // Step 3: Create session token
    const { createSessionToken } = await import("./_core/auth/jwt");
    const token = await createSessionToken(user.openId!, {
      name: user.name || "",
    });
    console.log("Token created:", token.substring(0, 50) + "...");

    // Step 4: Verify session
    const { verifySession } = await import("./_core/auth/jwt");
    const session = await verifySession(token);
    console.log("Session verified:", JSON.stringify(session));

    console.log("\n✅ LOGIN FLOW WORKS!");
  } catch (error: any) {
    console.error("ERROR:", error.message);
    if (error.cause) console.error("CAUSE:", error.cause.message);
  }

  await pool.end();
}

main();
