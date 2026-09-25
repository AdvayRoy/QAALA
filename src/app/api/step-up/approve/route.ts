import { getStore, json, optionalString, principalFromRequest, readJson } from "@/lib/http";
import { approveStepUp } from "@/lib/lifecycle";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const store = getStore();
  const body = await readJson(request);
  const result = approveStepUp(store, principalFromRequest(store, request), optionalString(body.pendingRequestId));
  return json(result.body, result.status);
}
