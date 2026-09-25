import { ManualClock } from "@/lib/clock";
import type { DemoRole } from "@/lib/domain/types";
import { SESSION_HEADER } from "@/lib/http";
import { createStore, type Store } from "@/lib/store";

import * as telemetryRoute from "@/app/api/entity-b/security-telemetry/route";
import * as citizenRoute from "@/app/api/entity-b/citizen-records/route";
import * as inspectRoute from "@/app/api/entity-b/connectors/b-17/route";
import * as isolateRoute from "@/app/api/entity-b/connectors/b-17/isolate/route";
import * as declareRoute from "@/app/api/mission/declare/route";
import * as proposeRoute from "@/app/api/leases/propose/route";
import * as issuerApproveRoute from "@/app/api/leases/issuer-approve/route";
import * as receiverAcceptRoute from "@/app/api/leases/receiver-accept/route";
import * as receiverRejectRoute from "@/app/api/leases/receiver-reject/route";
import * as revokeRoute from "@/app/api/leases/revoke/route";
import * as stepUpRoute from "@/app/api/step-up/approve/route";
import * as resetRoute from "@/app/api/demo/reset/route";
import * as stepRoute from "@/app/api/demo/step/route";
import * as stateRoute from "@/app/api/demo/state/route";
import * as sessionRoute from "@/app/api/demo/session/route";

export const T0 = "2026-09-25T10:00:00.000Z";

export interface Harness {
  store: Store;
  clock: ManualClock;
  token: Record<DemoRole, string>;
  api: (method: "GET" | "POST", path: string, opts?: { as?: DemoRole | null; token?: string; body?: unknown }) => Promise<ApiResponse>;
}

export interface ApiResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

type Handler = (request: Request) => Promise<Response>;

const ROUTES: Record<string, Partial<Record<"GET" | "POST", Handler>>> = {
  "/api/entity-b/security-telemetry": { GET: telemetryRoute.GET },
  "/api/entity-b/citizen-records": { GET: citizenRoute.GET },
  "/api/entity-b/connectors/b-17": { GET: inspectRoute.GET },
  "/api/entity-b/connectors/b-17/isolate": { POST: isolateRoute.POST },
  "/api/mission/declare": { POST: declareRoute.POST },
  "/api/leases/propose": { POST: proposeRoute.POST },
  "/api/leases/issuer-approve": { POST: issuerApproveRoute.POST },
  "/api/leases/receiver-accept": { POST: receiverAcceptRoute.POST },
  "/api/leases/receiver-reject": { POST: receiverRejectRoute.POST },
  "/api/leases/revoke": { POST: revokeRoute.POST },
  "/api/step-up/approve": { POST: stepUpRoute.POST },
  "/api/demo/reset": { POST: resetRoute.POST },
  "/api/demo/step": { GET: stepRoute.GET },
  "/api/demo/state": { GET: stateRoute.GET },
  "/api/demo/session": { GET: sessionRoute.GET, POST: sessionRoute.POST },
};

/** Fresh in-memory server state with a controllable clock, installed as the process store. */
export function createHarness(): Harness {
  const clock = new ManualClock(T0);
  const store = createStore(":memory:", clock);
  globalThis.__qalaaStore = store;
  const token: Record<DemoRole, string> = {
    AGENT: store.issueSession("AGENT").session.token,
    ISSUER_COMMANDER: store.issueSession("ISSUER_COMMANDER").session.token,
    RECEIVER_APPROVER: store.issueSession("RECEIVER_APPROVER").session.token,
  };

  const api: Harness["api"] = async (method, path, opts = {}) => {
    const url = new URL(path, "http://qalaa.local");
    const handler = ROUTES[url.pathname]?.[method];
    if (!handler) throw new Error(`No ${method} handler for ${url.pathname}`);
    const headers = new Headers();
    const tok = opts.token ?? (opts.as === null ? undefined : token[opts.as ?? "AGENT"]);
    if (tok) headers.set(SESSION_HEADER, tok);
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(opts.body);
    }
    const res = await handler(new Request(url, { method, headers, body }));
    return { status: res.status, body: await res.json() };
  };

  return { store, clock, token, api };
}

/** Drive the lifecycle to an ACTIVE, Entity B-accepted lease. */
export async function activateLease(h: Harness) {
  expectOk(await h.api("POST", "/api/mission/declare", { as: "ISSUER_COMMANDER" }));
  expectOk(await h.api("POST", "/api/leases/propose", { as: "ISSUER_COMMANDER" }));
  expectOk(await h.api("POST", "/api/leases/issuer-approve", { as: "ISSUER_COMMANDER" }));
  const accepted = expectOk(await h.api("POST", "/api/leases/receiver-accept", { as: "RECEIVER_APPROVER" }));
  return accepted.body.data as import("@/lib/domain/types").AuthorityLease;
}

export function expectOk(res: ApiResponse): ApiResponse {
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res;
}
