import type { NextRequest } from "next/server";
import { getStore } from "@/server/store";
import { normalizeEmail } from "@/server/participants";
import { AppError } from "@/server/errors";
import { bodyOf, handle, identityOf, json } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  return handle(() =>
    json({
      participant: getStore().participants.current(
        identityOf(req).participantToken,
      ),
    }),
  );
}
export async function POST(req: NextRequest) {
  return handle(async () => {
    const identity = identityOf(req);
    const input = await bodyOf(req);
    const store = getStore();
    if (input.action === "logout") {
      store.participants.logout(identity.participantToken);
      return json({ ok: true }, "", true);
    }
    if (input.action !== "register" && input.action !== "login")
      throw new AppError(400, "未知账号操作");
    const register = input.action === "register";
    store.throttle(
      identity.ip,
      register ? "participant-register-ip" : "participant-login-ip",
    );
    if (!register)
      store.throttle(normalizeEmail(input.email), "participant-login-account");
    const { token, ...result } = store.participants.authenticate(
      input,
      identity.uuid,
      register,
    );
    return json(result, token, true);
  });
}
