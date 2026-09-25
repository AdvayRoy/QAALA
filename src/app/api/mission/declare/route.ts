import { getStore, json, principalFromRequest } from "@/lib/http";
import { declareMission } from "@/lib/lifecycle";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const store = getStore();
  const result = declareMission(store, principalFromRequest(store, request));
  return json(result.body, result.status);
}
