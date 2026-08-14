import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const externalAccountProviders = ["anilist", "myanimelist", "discord"] as const;
export type ExternalAccountProvider = (typeof externalAccountProviders)[number];

export const externalAccountsTable = pgTable(
  "external_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    provider: text("provider").$type<ExternalAccountProvider>().notNull(),
    providerUserId: text("provider_user_id").notNull(),
    providerUsername: text("provider_username"),
    providerAvatarUrl: text("provider_avatar_url"),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => ({
    providerAccountUnique: unique("external_accounts_provider_account_unique").on(
      table.provider,
      table.providerUserId,
    ),
    userProviderUnique: unique("external_accounts_user_provider_unique").on(
      table.userId,
      table.provider,
    ),
  }),
);

export const insertExternalAccountSchema = createInsertSchema(externalAccountsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertExternalAccount = z.infer<typeof insertExternalAccountSchema>;
export type ExternalAccount = typeof externalAccountsTable.$inferSelect;