import { getStore, json, leaseSelector, principalFromRequest, readJson } from "@/lib/http";
import { isolateConnector } from "@/lib/protected";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const store = getStore();
  const body = await readJson(request);
  const result = isolateConnector(store, { principal: principalFromRequest(store, request), ...leaseSelector(request, body) });
  return json(result.body, result.status);
}
