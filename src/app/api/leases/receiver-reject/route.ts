import { getStore, json, leaseSelector, principalFromRequest, readJson } from "@/lib/http";
import { receiverReject } from "@/lib/lifecycle";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const store = getStore();
  const body = await readJson(request);
  const result = receiverReject(store, principalFromRequest(store, request), leaseSelector(request, body).leaseId);
  return json(result.body, result.status);
}
