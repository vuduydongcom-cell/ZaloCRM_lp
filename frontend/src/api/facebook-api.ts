/**
 * facebook-api.ts — Axios wrappers for Facebook integration endpoints.
 * All paths relative to /api/v1 (baseURL set in api/index.ts).
 *
 * FB-11: Manual mapping removed. Discovery is auto on OAuth callback.
 */
import { api } from '@/api/index';

const FB = '/integrations/facebook';

// ── DTO types ────────────────────────────────────────────────────────────────

export interface FacebookPageConnectionDto {
  id: string;
  pageId: string;
  pageName: string;
  status: 'connected' | 'revoked' | 'error';
  subscribedAt: string | null;
  tokenExpiresAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  lastLeadAt: string | null;
}

export interface FacebookFormMappingDto {
  id: string;
  orgId: string;
  pageConnectionId: string;
  formId: string;
  formName: string;
  customerListId: string;
  fieldMap: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  customerListName: string | null;
  leadCount: number;
  lastLeadAt: string | null;
  pageConnection: {
    pageId: string;
    pageName: string;
    status: string;
  };
  customerList: {
    id: string;
    name: string;
    iconEmoji: string | null;
  } | null;
}

export interface TokenRefreshSummary {
  checked: number;
  refreshed: number;
  errors: number;
}

// ── API functions ─────────────────────────────────────────────────────────────

/** Begin OAuth flow — POST with auth header, get Meta dialog URL, then redirect browser. */
export async function startFbOAuth(): Promise<string> {
  const { data } = await api.post<{ url: string }>(`${FB}/oauth/start`);
  return data.url;
}

// ── 2-tab shared config + OAuth + status ─────────────────────────────────────

export interface FacebookConfigDto {
  appId: string;
  webhookVerifyToken: string;
  hasAppSecret: boolean;
  hasTokenEncKey: boolean;
  oauthRedirectUri: string;
  graphApiVersion: string;
  fromEnvFallback: boolean;
}

export interface FacebookConfigUpdate {
  appId?: string;
  appSecret?: string;
  webhookVerifyToken?: string;
  tokenEncKey?: string;
}

export interface FacebookConnectionState {
  campaignConnected: boolean;
  formConnected: boolean;
}

export interface FacebookFormStatus {
  stats24h: { received: number; processed: number; unrouted: number; failed: number };
  webhookUrl: string;
  oauthRedirectUri: string;
  pages: Array<{ id: string; pageId: string; pageName: string | null; status: string; formCount: number }>;
  lists: Array<{
    id: string;
    name: string;
    iconEmoji: string | null;
    totalEntries: number;
    integrationKey: string | null;
    archivedAt: string | null;
  }>;
}

/** GET current Facebook app config (masked secrets). */
export async function getConfig(): Promise<FacebookConfigDto> {
  const { data } = await api.get<FacebookConfigDto>(`${FB}/config`);
  return data;
}

/** PUT config — only send secrets the user typed. Returns masked config. */
export async function putConfig(body: FacebookConfigUpdate): Promise<FacebookConfigDto> {
  const { data } = await api.put<FacebookConfigDto>(`${FB}/config`, body);
  return data;
}

/** Cross-tab mutual-exclusion state. */
export async function getConnectionState(): Promise<FacebookConnectionState> {
  const { data } = await api.get<FacebookConnectionState>(`${FB}/connection-state`);
  return data;
}

/** Form tab status (stats, webhook, redirect uri, pages, lists). */
export async function getFormStatus(): Promise<FacebookFormStatus> {
  const { data } = await api.get<FacebookFormStatus>(`${FB}/form/status`);
  return data;
}

/**
 * Start OAuth for a flow. Backend may return JSON {authUrl}/{url} or 302-redirect.
 * Returns the URL to navigate to (caller does window.location.href = url).
 * If backend 302s (axios follows it), the final URL is on the response request.
 */
export async function oauthStart(flow: 'campaign' | 'form'): Promise<string> {
  // BE: POST /oauth/start?flow= → { url }. (GET sẽ 405.)
  const res = await api.post<{ authUrl?: string; url?: string }>(`${FB}/oauth/start`, null, {
    params: { flow },
  });
  const data = res.data ?? {};
  if (data.authUrl) return data.authUrl;
  if (data.url) return data.url;
  // Fallback: axios followed a 302 — use the resolved request URL if present.
  const responseUrl = (res.request as { responseURL?: string } | undefined)?.responseURL;
  if (responseUrl) return responseUrl;
  // Last resort: full-page navigation to the endpoint itself.
  return `/api/v1${FB}/oauth/start?flow=${flow}`;
}

/** Disconnect a Form-tab page. */
export async function disconnectFormPage(pageId: string): Promise<void> {
  await api.post(`${FB}/pages/${pageId}/disconnect`);
}

/** Disconnect a Campaign-tab page. */
export async function disconnectCampaignPage(pageId: string): Promise<void> {
  await api.post(`${FB}/campaign/pages/${pageId}/disconnect`);
}

/** List connected Facebook pages for current org. */
export async function listPages(): Promise<FacebookPageConnectionDto[]> {
  const { data } = await api.get<FacebookPageConnectionDto[]>(`${FB}/pages`);
  return data;
}

/** Disconnect a page. Returns count of mappings that were disabled. */
export async function disconnectPage(
  pageId: string,
): Promise<{ success: boolean; disabledMappings: number }> {
  const { data } = await api.post<{ success: boolean; disabledMappings: number }>(
    `${FB}/pages/${pageId}/disconnect`,
  );
  return data;
}

/** List all form mappings for current org (auto-discovered, read-only). */
export async function listMappings(): Promise<FacebookFormMappingDto[]> {
  const { data } = await api.get<FacebookFormMappingDto[]>(`${FB}/mappings`);
  return data;
}

/**
 * Manually trigger form re-discovery for a connected page.
 * Returns jobId (may be null if Redis unavailable).
 */
export async function rediscoverPage(pageId: string): Promise<{ jobId: string | null }> {
  const { data } = await api.post<{ jobId: string | null }>(`${FB}/pages/${pageId}/rediscover`);
  return data;
}

/** Manual trigger: refresh tokens for all connected pages in current org. */
export async function adminRefreshTokens(): Promise<TokenRefreshSummary> {
  const { data } = await api.post<TokenRefreshSummary>(`${FB}/admin/refresh-tokens`);
  return data;
}
