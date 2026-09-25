import type { Principal } from "./domain/types";
import { getStore, type Store } from "./store";

export const SESSION_COOKIE = "qalaa_demo_session";
export const SESSION_HEADER = "x-qalaa-demo-session";

/**
 * Resolve the demo principal from a server-issued session token. The token is
 * opaque; identity is looked up in server state, never read from the client.
 */
export function principalFromRequest(store: Store, request: Request): Principal | null {
  const header = request.headers.get(SESSION_HEADER);
  if (header) return store.resolveSession(header.trim());
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!match) return null;
  return store.resolveSession(decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)));
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (!text) return {};
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function optionalString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 && v.length < 200 ? v : null;
}

export function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

/** Client may only pass opaque IDs; everything else is ignored. */
export function leaseSelector(request: Request, body?: Record<string, unknown>): { leaseId: string | null; missionId: string | null } {
  const url = new URL(request.url);
  return {
    leaseId: optionalString(body?.leaseId) ?? optionalString(url.searchParams.get("leaseId")),
    missionId: optionalString(body?.missionId) ?? optionalString(url.searchParams.get("missionId")),
  };
}

export { getStore };
