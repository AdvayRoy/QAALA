import type { DemoRole, Principal, ResolverResponse } from "@/lib/domain/types";
import type { Snapshot } from "@/lib/snapshot";

export const SESSION_HEADER = "x-qalaa-demo-session";

export interface ApiResult<T = unknown> {
  status: number;
  body: T;
}

export interface ProtectedBody extends ResolverResponse {
  data?: unknown;
  pendingRequestId?: string;
}

export interface LifecycleBody {
  ok: boolean;
  code: string;
  message: string;
  data?: unknown;
}

export interface SessionBody {
  ok: boolean;
  token: string;
  principal: Principal;
}

async function call<T>(method: "GET" | "POST", path: string, token?: string | null, body?: unknown): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers[SESSION_HEADER] = token;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { code: "INVALID_RESPONSE", reason: text.slice(0, 200) };
  }
  return { status: res.status, body: parsed as T };
}

export const api = {
  state: () => call<Snapshot>("GET", "/api/demo/state"),
  session: (role: DemoRole) => call<SessionBody>("POST", "/api/demo/session", null, { role }),
  reset: () => call<LifecycleBody & { snapshot: Snapshot }>("POST", "/api/demo/reset"),
  declare: (token: string) => call<LifecycleBody>("POST", "/api/mission/declare", token, {}),
  propose: (token: string) => call<LifecycleBody>("POST", "/api/leases/propose", token, {}),
  issuerApprove: (token: string) => call<LifecycleBody>("POST", "/api/leases/issuer-approve", token, {}),
  receiverAccept: (token: string) => call<LifecycleBody>("POST", "/api/leases/receiver-accept", token, {}),
  receiverReject: (token: string) => call<LifecycleBody>("POST", "/api/leases/receiver-reject", token, {}),
  revoke: (token: string) => call<LifecycleBody>("POST", "/api/leases/revoke", token, {}),
  approveStepUp: (token: string, pendingRequestId: string) => call<LifecycleBody>("POST", "/api/step-up/approve", token, { pendingRequestId }),
  telemetry: (token: string | null) => call<ProtectedBody>("GET", "/api/entity-b/security-telemetry", token),
  citizenRecords: (token: string | null) => call<ProtectedBody>("GET", "/api/entity-b/citizen-records", token),
  inspectConnector: (token: string | null) => call<ProtectedBody>("GET", "/api/entity-b/connectors/b-17", token),
  isolateConnector: (token: string | null) => call<ProtectedBody>("POST", "/api/entity-b/connectors/b-17/isolate", token, {}),
};
