import type { NextRequest } from "next/server";
import { getStore } from "@/server/store";
import { handle, identityOf, json } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  return handle(() => json(getStore().list(identityOf(req))));
}
