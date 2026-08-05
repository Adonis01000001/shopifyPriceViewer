export type * from "../drizzle/schema";
export * from "./_core/errors";

import type { User } from "../drizzle/schema";

export type PublicUser = Pick<
  User,
  | "id"
  | "email"
  | "name"
  | "role"
  | "avatarUrl"
  | "loginMethod"
  | "createdAt"
  | "updatedAt"
  | "lastSignedIn"
>;
