import { getStore, json } from "@/lib/http";
import { resetDemo } from "@/lib/lifecycle";
import { snapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export async function POST() {
  const store = getStore();
  const result = resetDemo(store);
  return json({ ...result.body, snapshot: snapshot(store) }, result.status);
}
