import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Store } from "../src/server/store";
if (
  !process.env.CLAIMLIST_E2E_DIR ||
  !process.env.DATABASE_PATH?.startsWith(process.env.CLAIMLIST_E2E_DIR)
)
  throw new Error("E2E 数据路径未隔离");
const store = new Store(process.env.DATABASE_PATH);
writeFileSync(
  join(process.env.CLAIMLIST_E2E_DIR, "init-token"),
  store.prepareSetup(),
  { mode: 0o600 },
);
store.close();
