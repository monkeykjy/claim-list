import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const folder = mkdtempSync(join(tmpdir(), "claimlist-runtime-"));
const origin = "http://127.0.0.1:3120";
const env = {
  ...process.env,
  DATABASE_PATH: join(folder, "list.sqlite"),
  APP_ORIGIN: origin,
  PORT: "3120",
  LISTEN_HOST: "127.0.0.1",
  TRUSTED_PROXY_IPS: "",
};
let child: ChildProcess | undefined;
let logs = "";
const cli = (...args: string[]) =>
  execFileSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "scripts/manage.ts",
      ...args,
    ],
    { env, encoding: "utf8" },
  );
async function start() {
  logs = "";
  child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/server.ts", "--production"],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout?.on("data", (d) => (logs += d));
  child.stderr?.on("data", (d) => (logs += d));
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(logs);
    if (logs.includes("ClaimList:")) {
      const response = await fetch(`${origin}/api/list`);
      assert.equal(response.status, 200);
      return;
    }
    await delay(100);
  }
  throw new Error(`服务启动超时 ${logs}`);
}
async function stop() {
  if (child && child.exitCode === null) {
    const p = child;
    await new Promise<void>((resolve) => {
      p.once("exit", () => resolve());
      p.kill("SIGTERM");
    });
  }
  child = undefined;
}
async function action(
  body: Record<string, unknown>,
  cookie = "",
  path = "/api/action",
) {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      origin,
      "Content-Type": "application/json",
      "x-browser-id": "a0000000-0000-4000-8000-000000000001",
      cookie,
    },
    body: JSON.stringify(body),
  });
}
async function main() {
  const token = cli("setup").trim().split("\n").at(-1)!;
  await start();
  const initialized = await action({
    action: "initialize",
    token,
    password: "runtime-test-password",
    confirm: "runtime-test-password",
  });
  assert.equal(initialized.status, 200);
  const cookie = initialized.headers.get("set-cookie")!.split(";")[0];
  assert(initialized.headers.get("set-cookie")!.includes("HttpOnly"));
  assert.equal(
    (await action({ action: "batch", text: "重启保留任务" }, cookie)).status,
    200,
  );
  const first = await (await fetch(`${origin}/api/list`)).json();
  const id = first.items[0].id;
  assert.equal(
    (await action({ action: "claim", id, name: "重启验收" })).status,
    200,
  );
  assert.equal((await action({ action: "complete", id })).status, 200);
  const registered = await action(
    {
      action: "register",
      email: "runtime@example.com",
      name: "运行验收",
      password: "12345678",
      confirm: "12345678",
    },
    "",
    "/api/participant",
  );
  assert.equal(registered.status, 200);
  assert.equal((await registered.json()).boundCount, 1);
  const participantCookie = registered.headers.get("set-cookie")!.split(";")[0];
  assert(registered.headers.get("set-cookie")!.includes("HttpOnly"));
  const before = await (await fetch(`${origin}/api/list`)).json();
  assert(before.items[0].completedAt);
  cli("backup", join(folder, "snapshot.sqlite"));
  let blocked = false;
  try {
    cli("restore", join(folder, "snapshot.sqlite"), "--confirm");
  } catch {
    blocked = true;
  }
  assert(blocked, "在线恢复必须拒绝");
  await stop();
  await start();
  const after = await (await fetch(`${origin}/api/list`)).json();
  assert.deepEqual(after, before);
  assert.equal(
    (await (await fetch(`${origin}/api/admin`, { headers: { cookie } })).json())
      .authenticated,
    true,
  );
  const participantAfter = await (
    await fetch(`${origin}/api/participant`, {
      headers: { cookie: participantCookie },
    })
  ).json();
  assert.equal(participantAfter.participant.name, "运行验收");
  assert.equal(
    (await action({ action: "batch", text: "恢复应移除" }, cookie)).status,
    200,
  );
  await stop();
  cli("restore", join(folder, "snapshot.sqlite"), "--confirm");
  await start();
  assert.deepEqual(await (await fetch(`${origin}/api/list`)).json(), before);
  assert.equal(
    (await (await fetch(`${origin}/api/admin`, { headers: { cookie } })).json())
      .authenticated,
    false,
  );
  assert.equal(
    (
      await (
        await fetch(`${origin}/api/participant`, {
          headers: { cookie: participantCookie },
        })
      ).json()
    ).participant,
    null,
  );
  const relogin = await action(
    { action: "login", email: "runtime@example.com", password: "12345678" },
    "",
    "/api/participant",
  );
  assert.equal(relogin.status, 200);
  assert.equal((await relogin.json()).boundCount, 0);
  assert.equal((await action({ action: "complete", id })).status, 403);
  console.log(
    "PASS: production API initialization, HttpOnly session, restart persistence, online backup, live restore rejection, offline restore and session invalidation.",
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stop();
    rmSync(folder, { recursive: true, force: true });
  });
