import { index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

// --- Connected Agents (ADR 0030) ---
//
// The tables of Better Auth's `jwt()` and `mcp()` plugins, which make the API the OAuth 2.1
// authorization server Connected Agents sign in through. Lists (`string[]`) and JSON are stored
// as JSON text, as Better Auth's adapter writes them on SQLite.

export const jwks = sqliteTable("jwks", {
  id: text().primaryKey(),
  publicKey: text("publicKey").notNull(),
  privateKey: text("privateKey").notNull(),
  createdAt: int("createdAt", { mode: "timestamp_ms" }).notNull(),
  expiresAt: int("expiresAt", { mode: "timestamp_ms" }),
  alg: text(),
  crv: text(),
});

export const oauthClient = sqliteTable(
  "oauthClient",
  {
    id: text().primaryKey(),
    clientId: text("clientId").notNull().unique(),
    clientSecret: text("clientSecret"),
    /** The discovery that created the client: `cimd` for a Client ID Metadata Document. */
    clientDiscoveryId: text("clientDiscoveryId"),
    disabled: int({ mode: "boolean" }).default(false),
    skipConsent: int("skipConsent", { mode: "boolean" }),
    enableEndSession: int("enableEndSession", { mode: "boolean" }),
    subjectType: text("subjectType"),
    scopes: text(),
    clientCredentialsScopes: text("clientCredentialsScopes"),
    userId: text("userId").references(() => user.id),
    createdAt: int("createdAt", { mode: "timestamp_ms" }),
    updatedAt: int("updatedAt", { mode: "timestamp_ms" }),
    name: text(),
    uri: text(),
    icon: text(),
    contacts: text(),
    tos: text(),
    policy: text(),
    softwareId: text("softwareId"),
    softwareVersion: text("softwareVersion"),
    softwareStatement: text("softwareStatement"),
    redirectUris: text("redirectUris").notNull(),
    postLogoutRedirectUris: text("postLogoutRedirectUris"),
    backchannelLogoutUri: text("backchannelLogoutUri"),
    backchannelLogoutSessionRequired: int("backchannelLogoutSessionRequired", { mode: "boolean" }),
    tokenEndpointAuthMethod: text("tokenEndpointAuthMethod"),
    applicationType: text("applicationType"),
    jwks: text(),
    jwksUri: text("jwksUri"),
    grantTypes: text("grantTypes"),
    responseTypes: text("responseTypes"),
    requirePKCE: int("requirePKCE", { mode: "boolean" }),
    dpopBoundAccessTokens: int("dpopBoundAccessTokens", { mode: "boolean" }).default(false),
    referenceId: text("referenceId"),
    metadata: text(),
  },
  (table) => [index("oauthClient_userId_idx").on(table.userId)],
);

export const oauthResource = sqliteTable("oauthResource", {
  id: text().primaryKey(),
  identifier: text().notNull().unique(),
  name: text().notNull(),
  accessTokenTtl: int("accessTokenTtl"),
  refreshTokenTtl: int("refreshTokenTtl"),
  signingAlgorithm: text("signingAlgorithm"),
  signingKeyId: text("signingKeyId"),
  allowedScopes: text("allowedScopes"),
  customClaims: text("customClaims"),
  dpopBoundAccessTokensRequired: int("dpopBoundAccessTokensRequired", { mode: "boolean" }).default(
    false,
  ),
  disabled: int({ mode: "boolean" }).default(false),
  createdAt: int("createdAt", { mode: "timestamp_ms" }),
  updatedAt: int("updatedAt", { mode: "timestamp_ms" }),
  policyVersion: int("policyVersion").default(1),
  metadata: text(),
});

export const oauthClientResource = sqliteTable(
  "oauthClientResource",
  {
    id: text().primaryKey(),
    clientId: text("clientId")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    resourceId: text("resourceId")
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: "cascade" }),
    metadata: text(),
    createdAt: int("createdAt", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("oauthClientResource_clientId_resourceId_uidx").on(
      table.clientId,
      table.resourceId,
    ),
    index("oauthClientResource_resourceId_idx").on(table.resourceId),
  ],
);

export const oauthRefreshToken = sqliteTable(
  "oauthRefreshToken",
  {
    id: text().primaryKey(),
    token: text().notNull().unique(),
    clientId: text("clientId")
      .notNull()
      .references(() => oauthClient.clientId),
    sessionId: text("sessionId").references(() => session.id, { onDelete: "set null" }),
    userId: text("userId")
      .notNull()
      .references(() => user.id),
    referenceId: text("referenceId"),
    authorizationCodeId: text("authorizationCodeId"),
    resources: text(),
    requestedUserInfoClaims: text("requestedUserInfoClaims"),
    expiresAt: int("expiresAt", { mode: "timestamp_ms" }).notNull(),
    createdAt: int("createdAt", { mode: "timestamp_ms" }).notNull(),
    revoked: int({ mode: "timestamp_ms" }),
    rotatedAt: int("rotatedAt", { mode: "timestamp_ms" }),
    rotationReplayResponse: text("rotationReplayResponse"),
    rotationReplayExpiresAt: int("rotationReplayExpiresAt", { mode: "timestamp_ms" }),
    authTime: int("authTime", { mode: "timestamp_ms" }),
    confirmation: text(),
    scopes: text().notNull(),
  },
  (table) => [
    index("oauthRefreshToken_clientId_idx").on(table.clientId),
    index("oauthRefreshToken_sessionId_idx").on(table.sessionId),
    index("oauthRefreshToken_userId_idx").on(table.userId),
    index("oauthRefreshToken_authorizationCodeId_idx").on(table.authorizationCodeId),
  ],
);

export const oauthAccessToken = sqliteTable(
  "oauthAccessToken",
  {
    id: text().primaryKey(),
    token: text().notNull().unique(),
    clientId: text("clientId")
      .notNull()
      .references(() => oauthClient.clientId),
    sessionId: text("sessionId").references(() => session.id, { onDelete: "set null" }),
    userId: text("userId").references(() => user.id),
    referenceId: text("referenceId"),
    authorizationCodeId: text("authorizationCodeId"),
    resources: text(),
    requestedUserInfoClaims: text("requestedUserInfoClaims"),
    refreshId: text("refreshId").references(() => oauthRefreshToken.id),
    expiresAt: int("expiresAt", { mode: "timestamp_ms" }).notNull(),
    createdAt: int("createdAt", { mode: "timestamp_ms" }).notNull(),
    revoked: int({ mode: "timestamp_ms" }),
    confirmation: text(),
    scopes: text().notNull(),
  },
  (table) => [
    index("oauthAccessToken_clientId_idx").on(table.clientId),
    index("oauthAccessToken_sessionId_idx").on(table.sessionId),
    index("oauthAccessToken_userId_idx").on(table.userId),
    index("oauthAccessToken_authorizationCodeId_idx").on(table.authorizationCodeId),
    index("oauthAccessToken_refreshId_idx").on(table.refreshId),
  ],
);

export const oauthConsent = sqliteTable(
  "oauthConsent",
  {
    id: text().primaryKey(),
    clientId: text("clientId")
      .notNull()
      .references(() => oauthClient.clientId),
    userId: text("userId").references(() => user.id),
    referenceId: text("referenceId"),
    resources: text(),
    requestedUserInfoClaims: text("requestedUserInfoClaims"),
    scopes: text().notNull(),
    createdAt: int("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: int("updatedAt", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("oauthConsent_clientId_idx").on(table.clientId),
    index("oauthConsent_userId_idx").on(table.userId),
  ],
);

/** Spent client assertions' ids, so none is used twice. */
export const oauthClientAssertion = sqliteTable("oauthClientAssertion", {
  id: text().primaryKey(),
  expiresAt: int("expiresAt", { mode: "timestamp_ms" }).notNull(),
});
