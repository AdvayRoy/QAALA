import { getStore, json } from "@/lib/http";
import { snapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  return json(snapshot(getStore()));
}
