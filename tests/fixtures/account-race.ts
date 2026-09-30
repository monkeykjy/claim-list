import { Store } from "../../src/server/store";
const [path, raw] = process.argv.slice(2);
const input = JSON.parse(raw);
const store = new Store(path);
const identity = {
  ip: "192.168.1.1",
  uuid: "a0000000-0000-4000-8000-000000000001",
};
process.send?.("ready");
process.once("message", () => {
  try {
    let boundCount = 0;
    if (input.action === "register" || input.action === "login")
      boundCount = store.participants.authenticate(
        { ...input, name: "张三", password: "12345678", confirm: "12345678" },
        identity.uuid,
        input.action === "register",
      ).boundCount;
    else if (input.action === "complete") store.complete(input.id, identity);
    else if (input.action === "claim") store.claim(input.id, "历史", identity);
    else
      store.edit(input.id, store.list(identity).items[0].revision, "release");
    process.send?.({ ok: true, boundCount });
  } catch {
    process.send?.({ ok: false });
  } finally {
    store.close();
    process.disconnect();
  }
});
