import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const nekoverseUsersTable = pgTable("nekoverse_users", {
  id: text("id").primaryKey(),
  username: text("username"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertNekoverseUserSchema = createInsertSchema(nekoverseUsersTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertNekoverseUser = z.infer<typeof insertNekoverseUserSchema>;
export type NekoverseUser = typeof nekoverseUsersTable.$inferSelect;