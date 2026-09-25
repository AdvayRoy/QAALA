import { getStore, json, leaseSelector, principalFromRequest } from "@/lib/http";
import { readCitizenRecords } from "@/lib/protected";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const store = getStore();
  const result = readCitizenRecords(store, { principal: principalFromRequest(store, request), ...leaseSelector(request) });
  return json(result.body, result.status);
}
