import { and, eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { Router, type IRouter, type Request } from "express";
import {
  AnilistGraphqlBody,
  AnilistGraphqlResponse,
  CompleteExternalAccountOAuthQueryParams,
  DisconnectExternalAccountParams,
  GetMyAnimeListQueryParams,
  ListExternalAccountsResponse,
  StartExternalAccountOAuthParams,
  UpdateMyAnimeListEntryBody,
  UpdateMyAnimeListEntryParams,
  UpdateMyAnimeListEntryResponse,
} from "@workspace/api-zod";
import {
  db,
  externalAccountsTable,
  externalAccountProviders,
  oauthStatesTable,
} from "@workspace/db";
import type { ExternalAccountProvider } from "@workspace/db";
import {
  authorizationUrl,
  callbackUrl,
  createCodeVerifier,
  createState,
  decryptSecret,
  encryptSecret,
  ensureNekoverseUser,
  exchangeCode,
  fetchProfile,
  getExternalAccount,
  getValidAccessToken,
  hashState,
  providerIsConfigured,
  stateBelongsToUser,
} from "../lib/oauth";
import {
  requireAuth,
  type AuthenticatedRequest,
} from "../middlewares/requireAuth";

const router: IRouter = Router();

function pathParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function providerParam(req: Request): ExternalAccountProvider | null {
  const parsed = StartExternalAccountOAuthParams.safeParse({
    provider: pathParam(req.params.provider),
  });
  return parsed.success ? parsed.data.provider : null;
}

function settingsRedirect(
  provider: ExternalAccountProvider,
  status: "connected" | "error",
  reason?: string,
): string {
  const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");
  const query = new URLSearchParams({ oauth: status, provider });
  if (reason) query.set("reason", reason);
  return `${basePath || ""}/settings?${query.toString()}`;
}

function requireOAuthCallbackAuth(
  req: Request,
  res: Parameters<NonNullable<IRouter["get"]>>[1],
  next: Parameters<NonNullable<IRouter["get"]>>[2],
): void {
  const { userId } = getAuth(req);
  if (!userId) {
    const provider = providerParam(req) ?? "anilist";
    res.redirect(settingsRedirect(provider, "error", "session_expired"));
    return;
  }

  (req as AuthenticatedRequest).userId = userId;
  next();
}

router.get("/integrations", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  await ensureNekoverseUser(userId);
  const accounts = await db
    .select({
      provider: externalAccountsTable.provider,
      username: externalAccountsTable.providerUsername,
      avatarUrl: externalAccountsTable.providerAvatarUrl,
      connectedAt: externalAccountsTable.createdAt,
    })
    .from(externalAccountsTable)
    .where(eq(externalAccountsTable.userId, userId));
  const byProvider = new Map(accounts.map((account) => [account.provider, account]));
  const response = {
    connections: externalAccountProviders.map((provider) => {
      const account = byProvider.get(provider);
      return {
        provider,
        connected: Boolean(account),
        username: account?.username ?? null,
        avatarUrl: account?.avatarUrl ?? null,
        connectedAt: account?.connectedAt ?? null,
      };
    }),
  };
  res.json(ListExternalAccountsResponse.parse(response));
});

router.get(
  "/integrations/:provider/start",
  requireAuth,
  async (req, res): Promise<void> => {
    const provider = providerParam(req);
    if (!provider) {
      res.status(400).json({ error: "Unsupported provider" });
      return;
    }
    const { userId } = req as AuthenticatedRequest;
    if (!providerIsConfigured(provider)) {
      req.log.error({ provider }, "OAuth provider is not configured");
      res.status(503).json({ error: "OAuth provider is not configured" });
      return;
    }

    await ensureNekoverseUser(userId);
    const state = createState();
    const codeVerifier = provider === "myanimelist" ? createCodeVerifier() : null;
    const redirectUri = callbackUrl(req, provider);
    await db.insert(oauthStatesTable).values({
      stateHash: hashState(state),
      userId,
      provider,
      codeVerifier: codeVerifier ? encryptSecret(codeVerifier) : null,
      redirectUri,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    res.redirect(authorizationUrl(provider, redirectUri, state, codeVerifier ?? undefined));
  },
);

router.get(
  "/integrations/:provider/callback",
  requireOAuthCallbackAuth,
  async (req, res): Promise<void> => {
    const provider = providerParam(req);
    if (!provider) {
      res.redirect(settingsRedirect("anilist", "error", "unsupported_provider"));
      return;
    }

    const { userId } = req as AuthenticatedRequest;
    const query = CompleteExternalAccountOAuthQueryParams.safeParse({
      code: typeof req.query.code === "string" ? req.query.code : undefined,
      state: typeof req.query.state === "string" ? req.query.state : undefined,
      error: typeof req.query.error === "string" ? req.query.error : undefined,
    });
    if (!query.success || !query.data.state) {
      res.redirect(settingsRedirect(provider, "error", "invalid_callback"));
      return;
    }
    if (query.data.error || !query.data.code) {
      res.redirect(settingsRedirect(provider, "error", "access_denied"));
      return;
    }

    const storedState = await stateBelongsToUser(hashState(query.data.state), userId, provider);
    if (!storedState) {
      res.redirect(settingsRedirect(provider, "error", "invalid_state"));
      return;
    }

    try {
      await db
        .delete(oauthStatesTable)
        .where(eq(oauthStatesTable.stateHash, storedState.stateHash));
      const codeVerifier = storedState.codeVerifier
        ? decryptSecret(storedState.codeVerifier)
        : undefined;
      const token = await exchangeCode(provider, query.data.code, storedState.redirectUri, codeVerifier);
      const profile = await fetchProfile(provider, token.access_token);
      const existingProviderAccount = await db
        .select({ userId: externalAccountsTable.userId })
        .from(externalAccountsTable)
        .where(
          and(
            eq(externalAccountsTable.provider, provider),
            eq(externalAccountsTable.providerUserId, profile.providerUserId),
          ),
        )
        .limit(1);
      if (existingProviderAccount[0] && existingProviderAccount[0].userId !== userId) {
        res.redirect(settingsRedirect(provider, "error", "already_linked"));
        return;
      }

      const existingUserAccount = await getExternalAccount(userId, provider);
      const values = {
        id: existingUserAccount?.id ?? `${userId}:${provider}`,
        userId,
        provider,
        providerUserId: profile.providerUserId,
        providerUsername: profile.providerUsername,
        providerAvatarUrl: profile.providerAvatarUrl,
        accessToken: encryptSecret(token.access_token),
        refreshToken: token.refresh_token ? encryptSecret(token.refresh_token) : null,
        expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
        updatedAt: new Date(),
      };
      if (existingUserAccount) {
        await db
          .update(externalAccountsTable)
          .set(values)
          .where(eq(externalAccountsTable.id, existingUserAccount.id));
      } else {
        await db.insert(externalAccountsTable).values(values);
      }
      res.redirect(settingsRedirect(provider, "connected"));
    } catch (error) {
      req.log.error({ err: error, provider }, "External account OAuth callback failed");
      res.redirect(settingsRedirect(provider, "error", "provider_error"));
    }
  },
);

router.delete(
  "/integrations/:provider",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = DisconnectExternalAccountParams.safeParse({
      provider: pathParam(req.params.provider),
    });
    if (!parsed.success) {
      res.status(400).json({ error: "Unsupported provider" });
      return;
    }
    const { userId } = req as AuthenticatedRequest;
    const deleted = await db
      .delete(externalAccountsTable)
      .where(
        and(
          eq(externalAccountsTable.userId, userId),
          eq(externalAccountsTable.provider, parsed.data.provider),
        ),
      )
      .returning({ id: externalAccountsTable.id });
    if (!deleted.length) {
      res.status(404).json({ error: "Connection not found" });
      return;
    }
    res.sendStatus(204);
  },
);

router.post(
  "/integrations/anilist/graphql",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = AnilistGraphqlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { userId } = req as AuthenticatedRequest;
    const account = await getExternalAccount(userId, "anilist");
    if (!account) {
      res.status(404).json({ error: "AniList is not connected" });
      return;
    }
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        authorization: `Bearer ${await getValidAccessToken(account)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(parsed.data),
    });
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      res.status(502).json({ error: "AniList request failed" });
      return;
    }
    res.json(AnilistGraphqlResponse.parse(payload));
  },
);

router.get(
  "/integrations/myanimelist/animelist",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = GetMyAnimeListQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { userId } = req as AuthenticatedRequest;
    const account = await getExternalAccount(userId, "myanimelist");
    if (!account) {
      res.status(404).json({ error: "MyAnimeList is not connected" });
      return;
    }
    const url = new URL("https://api.myanimelist.net/v2/users/@me/animelist");
    if (parsed.data.status) url.searchParams.set("status", parsed.data.status);
    if (parsed.data.limit !== undefined) url.searchParams.set("limit", String(parsed.data.limit));
    if (parsed.data.offset !== undefined) url.searchParams.set("offset", String(parsed.data.offset));
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${await getValidAccessToken(account)}` },
    });
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      res.status(502).json({ error: "MyAnimeList request failed" });
      return;
    }
    res.json(payload);
  },
);

router.patch(
  "/integrations/myanimelist/animelist/:animeId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = UpdateMyAnimeListEntryParams.safeParse({
      animeId: pathParam(req.params.animeId),
    });
    const body = UpdateMyAnimeListEntryBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid MyAnimeList update" });
      return;
    }
    const { userId } = req as AuthenticatedRequest;
    const account = await getExternalAccount(userId, "myanimelist");
    if (!account) {
      res.status(404).json({ error: "MyAnimeList is not connected" });
      return;
    }
    const response = await fetch(
      `https://api.myanimelist.net/v2/anime/${params.data.animeId}/my_list_status`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${await getValidAccessToken(account)}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(
          Object.entries(body.data).map(([key, value]) => [key, String(value)]),
        ),
      },
    );
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      res.status(502).json({ error: "MyAnimeList update failed" });
      return;
    }
    res.json(UpdateMyAnimeListEntryResponse.parse(payload));
  },
);

export default router;