import type { NextRequest } from "next/server";
import { getStore } from "@/server/store";
import { AppError } from "@/server/errors";
import { bodyOf, handle, identityOf, json, tokenOf } from "@/server/http";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  return handle(async () => {
    const identity = identityOf(req);
    const input = await bodyOf(req);
    const store = getStore();
    const token = tokenOf(req);
    switch (input.action) {
      case "initialize":
        store.throttle(identity.ip);
        if (input.password !== input.confirm)
          throw new AppError(400, "两次密码不一致");
        return json(
          { ok: true },
          store.initialize(input.token, input.password),
        );
      case "login":
        store.throttle(identity.ip);
        return json({ ok: true }, store.login(input.password));
      case "logout":
        store.logout(token);
        return json({ ok: true }, "");
      case "password":
        if (input.password !== input.confirm)
          throw new AppError(400, "两次密码不一致");
        store.changePassword(token, input.oldPassword, input.password);
        return json({ ok: true }, "");
      case "claim":
        store.claim(
          input.id,
          input.name,
          identity,
          input.expectedAccountId ?? null,
        );
        break;
      case "complete":
        store.complete(input.id, identity);
        break;
      case "participant-search":
        return json({
          accounts: store.authorized(token, () =>
            store.participants.search(input.query),
          ),
        });
      case "participant-reset":
        store.authorized(token, () =>
          store.participants.reset(input.id, input.password, input.confirm),
        );
        break;
      case "batch":
        return json({
          count: store.authorized(token, () => store.addBatch(input.text)),
        });
      case "config":
        store.authorized(token, () => store.saveConfig(input));
        break;
      case "edit":
        if (typeof input.operation !== "string")
          throw new AppError(400, "操作不正确");
        store.authorized(token, () =>
          store.edit(
            input.id,
            input.revision,
            input.operation as string,
            input.value,
          ),
        );
        break;
      default:
        throw new AppError(400, "未知操作");
    }
    return json({ ok: true });
  });
}
