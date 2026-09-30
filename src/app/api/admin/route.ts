import type { NextRequest } from "next/server";
import { getStore } from "@/server/store";
import { handle, identityOf, json, tokenOf } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  return handle(() => {
    const identity = identityOf(req);
    const store = getStore();
    const authenticated = store.authenticated(tokenOf(req));
    return json({
      initialized: store.initialized(),
      authenticated,
      ...(authenticated ? { list: store.list(identity) } : {}),
    });
  });
}
