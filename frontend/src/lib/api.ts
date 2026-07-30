import { supabase } from '@/lib/supabase';

export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');

export async function getApiBearerToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch (e) {
    console.warn('[api] getSession failed:', e);
    return null;
  }
}

export async function getApiHeaders(opts: { json?: boolean; bearer?: boolean; custom?: Record<string, string> } = {}): Promise<Record<string, string>> {
  const { json = true, bearer = true, custom } = opts;
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (bearer) {
    const token = await getApiBearerToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  if (custom) {
    for (const k of Object.keys(custom)) {
      headers[k] = custom[k];
    }
  }
  return headers;
}

export function formatApiError(opts: { prefix: string; err?: unknown; response?: Response | null; detailFallback?: string }): string {
  const { prefix, err, response, detailFallback } = opts;
  const parts: string[] = [];
  if (response?.status) parts.push(`HTTP ${response.status}${response.statusText ? ` (${response.statusText})` : ''}`);
  if (detailFallback) parts.push(detailFallback);
  if (err) {
    if (err instanceof Error && err.message && !detailFallback) parts.push(err.message);
  }
  return `${prefix}${parts.length > 0 ? ' — ' + parts.join(' | ') : ''}`;
}

export async function extractDetailText(resp: Response): Promise<string> {
  try {
    const t = await resp.clone().text();
    if (!t) return '';
    try {
      const j = JSON.parse(t);
      if (j?.detail) {
        return typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail);
      }
      if (j?.error) {
        return typeof j.error === 'string' ? j.error : JSON.stringify(j.error);
      }
      if (j?.message) {
        return typeof j.message === 'string' ? j.message : JSON.stringify(j.message);
      }
      return t.slice(0, 280);
    } catch {
      return t.slice(0, 280);
    }
  } catch {
    return '';
  }
}

export async function apiFetch(
  endpoint: string,
  init: RequestInit = {},
  opts: { bearer?: boolean; jsonBody?: boolean; prefix?: string; throwOnError?: boolean } = {}
): Promise<Response> {
  const { bearer = true, jsonBody = true, prefix = 'Erro', throwOnError = true } = opts;
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
  const headers = new Headers(init.headers || {});
  if (bearer) {
    const token = await getApiBearerToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }
  if (jsonBody && (init.body == null || typeof init.body === 'object') && !(init.body instanceof FormData) && !(init.body instanceof Blob)) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
  }
  try {
    const response = await fetch(url, {
      credentials: 'include',
      ...init,
      headers,
    });
    if (throwOnError && !response.ok) {
      const detail = await extractDetailText(response);
      throw new Error(formatApiError({ prefix, response, detailFallback: detail }));
    }
    return response;
  } catch (err) {
    if (throwOnError) throw err;
    throw err;
  }
}

export function apiAlert(prefix: string, err: unknown): string {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Erro de rede ou conexão com o servidor';
  const final = `${prefix} — ${msg}`;
  alert(final);
  return final;
}
