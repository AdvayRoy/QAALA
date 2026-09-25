import type { DemoRole } from "@/lib/domain/types";
import { getStore, json, principalFromRequest, readJson, SESSION_COOKIE } from "@/lib/http";

export const dynamic = "force-dynamic";

const ROLES: DemoRole[] = ["AGENT", "ISSUER_COMMANDER", "RECEIVER_APPROVER"];

/**
 * Demo identity mechanism. Issues a server-side session for one of the three
 * synthetic roles. This is a local-only role switch, not authentication.
 */
export async function POST(request: Request) {
  const store = getStore();
  const body = await readJson(request);
  const role = body.role;
  if (typeof role !== "string" || !(ROLES as string[]).includes(role)) {
    return json({ ok: false, code: "ROLE_INVALID", message: `role must be one of ${ROLES.join(", ")}` }, 400);
  }
  const { session, principal } = store.issueSession(role as DemoRole);
  return json(
    { ok: true, code: "SESSION_ISSUED", synthetic: true, token: session.token, principal },
    200,
    { "set-cookie": `${SESSION_COOKIE}=${encodeURIComponent(session.token)}; Path=/; SameSite=Lax; HttpOnly` },
  );
}

export async function GET(request: Request) {
  const store = getStore();
  const principal = principalFromRequest(store, request);
  return json({ ok: true, synthetic: true, principal });
}
