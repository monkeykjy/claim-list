import { Store } from "../../src/server/store";
const [path, action, id, suffix] = process.argv.slice(2);
const store = new Store(path);
process.on("message", () => {
  try {
    if (action === "initialize") store.initialize(id, "a-valid-test-password");
    else if (action === "claim")
      store.claim(id, `参与者${suffix}`, {
        ip: `192.168.0.${suffix}`,
        uuid: suffix,
      });
    else store.addBatch(`并发标题\n独有${suffix}`);
    process.send?.({ ok: true });
  } catch (error) {
    process.send?.({ ok: false, message: (error as Error).message });
  } finally {
    store.close();
    process.disconnect();
  }
});
process.send?.("ready");
