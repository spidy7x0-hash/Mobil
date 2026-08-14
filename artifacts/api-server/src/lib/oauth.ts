import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import {
  db,
  externalAccountsTable,
  nekoverseUsersTable,
  oauthStatesTable,
} from "@workspace/db";
import type {
  ExternalAccount,
  ExternalAccountProvider,
} from "@workspace/db";

const ANILIST_ENDPOINT = "https://graphql.anilist.co";
const OAUTH_TOKEN_TTL_SECONDS = 60;

function encryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET must be configured for OAuth token encryption");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptSecret(value: string): string {
  const [version, ivValue, tagValue, ciphertextValue] = value.split(":");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Unsupported encrypted secret format");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export function createState(): string {
  return randomBytes(32).toString("base64url");
}

export function createCodeVerifier(): string {
  return randomBytes(48).toString("base64url");
}

export function createCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export function providerIsConfigured(provider: ExternalAccountProvider): boolean {
  if (provider === "anilist") {
    return Boolean(process.env.ANILIST_CLIENT_ID && process.env.ANILIST_CLIENT_SECRET);
  }
  if (provider === "myanimelist") {
    return Boolean(process.env.MYANIMELIST_CLIENT_ID);
  }
  return Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);
}

export function callbackUrl(
  req: { headers: Record<string, string | string[] | undefined>; get(name: string): string | undefined },
  provider: ExternalAccountProvider,
): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(",")[0]?.trim() || "http";
  const forwardedHost = req.headers["x-forwarded-host"];
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost)?.split(",")[0]?.trim() || req.get("host");
  if (!host) {
    throw new Error("Unable to determine public host for OAuth callback");
  }
  return `${protocol}://${host}/api/integrations/${provider}/callback`;
}

export function authorizationUrl(
  provider: ExternalAccountProvider,
  redirectUri: string,
  state: string,
  codeVerifier?: string,
): string {
  const url =
    provider === "anilist"
      ? new URL("https://anilist.co/api/v2/oauth/authorize")
      : provider === "myanimelist"
        ? new URL("https://myanimelist.net/v1/oauth2/authorize")
        : new URL("https://discord.com/oauth2/authorize");

  const params = new URLSearchParams({
    response_type: "code",
    redirect_uri: redirectUri,
    state,
  });

  if (provider === "anilist") {
    params.set("client_id", process.env.ANILIST_CLIENT_ID!);
  } else if (provider === "myanimelist") {
    params.set("client_id", process.env.MYANIMELIST_CLIENT_ID!);
    params.set("code_challenge", createCodeChallenge(codeVerifier!));
    params.set("code_challenge_method", "S256");
  } else {
    params.set("client_id", process.env.DISCORD_CLIENT_ID!);
    params.set("scope", "identify");
  }

  url.search = params.toString();
  return url.toString();
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};

async function parseUpstreamJson(response: Response): Promise<Record<string, unknown>> {
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      typeof payload === "object" && payload !== null
        ? JSON.stringify(payload)
        : response.statusText;
    throw new Error(`OAuth provider request failed (${response.status}): ${detail}`);
  }
  if (typeof payload !== "object" || payload === null) {
    throw new Error("OAuth provider returned an invalid response");
  }
  return payload as Record<string, unknown>;
}

export async function exchangeCode(
  provider: ExternalAccountProvider,
  code: string,
  redirectUri: string,
  codeVerifier?: string,
): Promise<TokenResponse> {
  if (provider === "anilist") {
    const response = await fetch("https://anilist.co/api/v2/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: process.env.ANILIST_CLIENT_ID,
        client_secret: process.env.ANILIST_CLIENT_SECRET,
        redirect_uri: redirectUri,
        code,
      }),
    });
    return parseTokenResponse(await parseUpstreamJson(response));
  }

  if (provider === "myanimelist") {
    const body = new URLSearchParams({
      client_id: process.env.MYANIMELIST_CLIENT_ID!,
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier!,
    });
    const response = await fetch("https://myanimelist.net/v1/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    return parseTokenResponse(await parseUpstreamJson(response));
  }

  const body = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID!,
    client_secret: process.env.DISCORD_CLIENT_SECRET!,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  return parseTokenResponse(await parseUpstreamJson(response));
}

function parseTokenResponse(payload: Record<string, unknown>): TokenResponse {
  if (typeof payload.access_token !== "string") {
    throw new Error("OAuth provider did not return an access token");
  }
  return {
    access_token: payload.access_token,
    refresh_token: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
    expires_in: typeof payload.expires_in === "number" ? payload.expires_in : undefined,
  };
}

async function fetchJson(
  url: string,
  options: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, options);
  return parseUpstreamJson(response);
}

export type ExternalProfile = {
  providerUserId: string;
  providerUsername: string;
  providerAvatarUrl: string | null;
};

export async function fetchProfile(
  provider: ExternalAccountProvider,
  accessToken: string,
): Promise<ExternalProfile> {
  if (provider === "anilist") {
    const payload = await fetchJson(ANILIST_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: "query { Viewer { id name avatar { large medium } } }",
      }),
    });
    const viewer = (payload.data as { Viewer?: Record<string, unknown> } | undefined)?.Viewer;
    if (!viewer || typeof viewer.id !== "number" || typeof viewer.name !== "string") {
      throw new Error("AniList did not return the authenticated viewer");
    }
    const avatar = viewer.avatar as { large?: unknown; medium?: unknown } | undefined;
    return {
      providerUserId: String(viewer.id),
      providerUsername: viewer.name,
      providerAvatarUrl:
        typeof avatar?.large === "string"
          ? avatar.large
          : typeof avatar?.medium === "string"
            ? avatar.medium
            : null,
    };
  }

  if (provider === "myanimelist") {
    const payload = await fetchJson("https://api.myanimelist.net/v2/users/@me", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (typeof payload.id !== "number" || typeof payload.name !== "string") {
      throw new Error("MyAnimeList did not return the authenticated profile");
    }
    return {
      providerUserId: String(payload.id),
      providerUsername: payload.name,
      providerAvatarUrl: typeof payload.picture === "string" ? payload.picture : null,
    };
  }

  const payload = await fetchJson("https://discord.com/api/users/@me", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (typeof payload.id !== "string") {
    throw new Error("Discord did not return the authenticated user");
  }
  const avatarHash = typeof payload.avatar === "string" ? payload.avatar : null;
  return {
    providerUserId: payload.id,
    providerUsername:
      typeof payload.global_name === "string"
        ? payload.global_name
        : typeof payload.username === "string"
          ? payload.username
          : payload.id,
    providerAvatarUrl: avatarHash
      ? `https://cdn.discordapp.com/avatars/${payload.id}/${avatarHash}.png?size=128`
      : null,
  };
}

export async function ensureNekoverseUser(userId: string): Promise<void> {
  await db.insert(nekoverseUsersTable).values({ id: userId }).onConflictDoNothing();
}

export async function getExternalAccount(
  userId: string,
  provider: ExternalAccountProvider,
): Promise<ExternalAccount | undefined> {
  const [account] = await db
    .select()
    .from(externalAccountsTable)
    .where(and(eq(externalAccountsTable.userId, userId), eq(externalAccountsTable.provider, provider)))
    .limit(1);
  return account;
}

export async function getValidAccessToken(
  account: ExternalAccount,
): Promise<string> {
  if (
    !account.expiresAt ||
    account.expiresAt.getTime() > Date.now() + OAUTH_TOKEN_TTL_SECONDS * 1000 ||
    !account.refreshToken ||
    account.provider !== "myanimelist"
  ) {
    return decryptSecret(account.accessToken);
  }

  const body = new URLSearchParams({
    client_id: process.env.MYANIMELIST_CLIENT_ID!,
    grant_type: "refresh_token",
    refresh_token: decryptSecret(account.refreshToken),
  });
  const response = await fetch("https://myanimelist.net/v1/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const token = parseTokenResponse(await parseUpstreamJson(response));
  await db
    .update(externalAccountsTable)
    .set({
      accessToken: encryptSecret(token.access_token),
      refreshToken: token.refresh_token ? encryptSecret(token.refresh_token) : account.refreshToken,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
      updatedAt: new Date(),
    })
    .where(eq(externalAccountsTable.id, account.id));
  return token.access_token;
}

export async function stateBelongsToUser(
  stateHash: string,
  userId: string,
  provider: ExternalAccountProvider,
) {
  const [state] = await db
    .select()
    .from(oauthStatesTable)
    .where(
      and(
        eq(oauthStatesTable.stateHash, stateHash),
        eq(oauthStatesTable.userId, userId),
        eq(oauthStatesTable.provider, provider),
        gt(oauthStatesTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return state;
}