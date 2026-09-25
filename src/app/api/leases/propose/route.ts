import { getStore, json, principalFromRequest } from "@/lib/http";
import { generateProposal } from "@/lib/lifecycle";
import { configuredGenerator } from "@/lib/model";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const store = getStore();
  const result = await generateProposal(store, principalFromRequest(store, request), { generator: configuredGenerator() });
  return json(result.body, result.status);
}
