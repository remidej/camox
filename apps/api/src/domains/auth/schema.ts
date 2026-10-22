import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Column names use camelCase to match better-auth's internal field names.

export const user = sqliteTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: int("emailVerified", { mode: "boolean" }).notNull().default(false),
  image: text(),
  createdAt: int("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: int("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text().primaryKey(),
  expiresAt: int("expiresAt", { mode: "timestamp_ms" }).notNull(),
  token: text().notNull().unique(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  activeOrganizationId: text("activeOrganizationId"),
  /** A session handed to the studio on a site, whose scripts can read it: it can't sign anything else in. */
  studio: int("studio", { mode: "boolean" }).notNull().default(false),
  createdAt: int("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: int("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const account = sqliteTable("account", {
  id: text().primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: int("accessTokenExpiresAt", { mode: "timestamp_ms" }),
  refreshTokenExpiresAt: int("refreshTokenExpiresAt", { mode: "timestamp_ms" }),
  scope: text(),
  password: text(),
  createdAt: int("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: int("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: int("expiresAt", { mode: "timestamp_ms" }).notNull(),
  createdAt: int("createdAt", { mode: "timestamp_ms" }),
  updatedAt: int("updatedAt", { mode: "timestamp_ms" }),
});

export const organizationTable = sqliteTable("organization", {
  id: text().primaryKey(),
  name: text().notNull(),
  slug: text().unique(),
  logo: text(),
  metadata: text(),
  createdAt: int("createdAt", { mode: "timestamp_ms" }).notNull(),
});

export const member = sqliteTable("member", {
  id: text().primaryKey(),
  organizationId: text("organizationId")
    .notNull()
    .references(() => organizationTable.id),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  role: text().notNull().default("member"),
  createdAt: int("createdAt", { mode: "timestamp_ms" }).notNull(),
});

export const invitation = sqliteTable("invitation", {
  id: text().primaryKey(),
  organizationId: text("organizationId")
    .notNull()
    .references(() => organizationTable.id),
  email: text().notNull(),
  role: text(),
  status: text().notNull().default("pending"),
  teamId: text(),
  expiresAt: int("expiresAt", { mode: "timestamp_ms" }).notNull(),
  createdAt: int("createdAt", { mode: "timestamp_ms" }).notNull(),
  inviterId: text("inviterId")
    .notNull()
    .references(() => user.id),
});
