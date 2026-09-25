import { getStore, json, leaseSelector, principalFromRequest } from "@/lib/http";
import { inspectConnector } from "@/lib/protected";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const store = getStore();
  const result = inspectConnector(store, { principal: principalFromRequest(store, request), ...leaseSelector(request) });
  return json(result.body, result.status);
}
