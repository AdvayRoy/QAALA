import { getStore, json } from "@/lib/http";
import { currentStep } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = getStore();
  return json({ step: currentStep(store), serverTime: store.nowIso(), synthetic: true });
}
