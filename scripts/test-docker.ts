import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Build claimlist:local first. Use a unique Compose project and an isolated bind mount.
const root = resolve("data");
mkdirSync(root, { recursive: true });
const directory = mkdtempSync(join(root, "docker-verification-"));
const project = `claimlist-test-${process.pid}`;
const port = process.env.CLAIMLIST_DOCKER_TEST_PORT || "3124";
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  CLAIMLIST_BIND_IP: "127.0.0.1",
  CLAIMLIST_PORT: port,
  CLAIMLIST_DATA_DIR: directory,
  APP_ORIGIN: origin,
  TRUSTED_PROXY_IPS: "",
};
const composeArgs = ["compose", "--project-name", project];
function compose(...args: string[]) {
  return execFileSync("docker", [...composeArgs, ...args], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function rejected(...args: string[]) {
  const result = spawnSync("docker", [...composeArgs, ...args], {
    env,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    73,
    "concurrent container must fail on the data lock",
  );
}
const uuid = "a0000000-0000-4000-8000-000000000001";
async function get(path: string, cookie = "") {
  const response = await fetch(`${origin}${path}`, {
    headers: { cookie, "x-browser-id": uuid },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  return response.json();
}
async function post(path: string, body: Record<string, unknown>, cookie = "") {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      origin,
      cookie,
      "x-browser-id": uuid,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return {
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0] || "",
  };
}
async function ready() {
  for (let i = 0; i < 100; i++) {
    try {
      await get("/api/list");
      return;
    } catch {
      await delay(200);
    }
  }
  throw new Error(
    `Container did not become ready: ${compose("logs", "--tail", "30")}`,
  );
}
async function main() {
  compose("config", "--quiet");
  const token = compose(
    "run",
    "--rm",
    "--no-deps",
    "claimlist",
    "pnpm",
    "setup",
  )
    .split("\n")
    .at(-1)!;
  compose("up", "-d", "--no-build");
  await ready();
  assert.equal(
    compose("exec", "-T", "--user", "node", "claimlist", "id", "-u"),
    "1000",
  );
  // Read the actual server process owner, not just the docker-exec user.
  const serverUid = compose(
    "exec",
    "-T",
    "claimlist",
    "node",
    "-e",
    `
    const fs=require('node:fs');
    for (const pid of fs.readdirSync('/proc').filter(p=>/^\\d+$/.test(p))) {
      try {
        const cmd=fs.readFileSync('/proc/'+pid+'/cmdline','utf8');
        if(cmd.startsWith('node\\0--import\\0tsx\\0scripts/server.ts\\0')) {
          console.log(fs.readFileSync('/proc/'+pid+'/status','utf8').match(/Uid:\\s+(\\d+)/)[1]);
        }
      } catch {}
    }
  `,
  );
  assert.equal(serverUid, "1000");
  const admin = await post("/api/action", {
    action: "initialize",
    token,
    password: "12345678",
    confirm: "12345678",
  });
  await post(
    "/api/action",
    { action: "batch", text: "容器持久化任务" },
    admin.cookie,
  );
  const first = await get("/api/list");
  const id = first.items[0].id;
  await post("/api/action", { action: "claim", id, name: "历史姓名" });
  const participant = await post("/api/participant", {
    action: "register",
    email: "docker-test@example.com",
    name: "容器验收",
    password: "12345678",
    confirm: "12345678",
  });
  assert.equal(participant.data.boundCount, 1);
  await post("/api/action", { action: "complete", id }, participant.cookie);
  const before = await get("/api/list", participant.cookie);
  const check = async () => {
    assert.deepEqual(await get("/api/list", participant.cookie), before);
    assert.equal((await get("/api/admin", admin.cookie)).authenticated, true);
  };
  compose(
    "exec",
    "-T",
    "--user",
    "node",
    "claimlist",
    "pnpm",
    "db:backup",
    "/data/backups/snapshot.sqlite",
  );
  rejected("run", "--rm", "--no-deps", "claimlist", "true");
  rejected(
    "run",
    "--rm",
    "--no-deps",
    "claimlist",
    "pnpm",
    "db:restore",
    "/data/backups/snapshot.sqlite",
    "--confirm",
  );
  compose("restart");
  await ready();
  await check();
  compose("kill", "--signal", "SIGKILL");
  compose("up", "-d", "--no-build");
  await ready();
  await check();
  compose("up", "-d", "--no-build", "--force-recreate");
  await ready();
  await check();
  await post(
    "/api/action",
    { action: "batch", text: "恢复后移除" },
    admin.cookie,
  );
  compose("stop");
  compose(
    "run",
    "--rm",
    "--no-deps",
    "claimlist",
    "pnpm",
    "db:restore",
    "/data/backups/snapshot.sqlite",
    "--confirm",
  );
  compose("up", "-d", "--no-build");
  await ready();
  assert.equal((await get("/api/admin", admin.cookie)).authenticated, false);
  assert.equal(
    (await get("/api/participant", participant.cookie)).participant,
    null,
  );
  const login = await post("/api/participant", {
    action: "login",
    email: "docker-test@example.com",
    password: "12345678",
  });
  assert.deepEqual(await get("/api/list", login.cookie), before);
  const container = compose("ps", "-q", "claimlist");
  for (let i = 0; i < 40; i++) {
    const status = execFileSync(
      "docker",
      ["inspect", "--format", "{{.State.Health.Status}}", container],
      { encoding: "utf8" },
    ).trim();
    if (status === "healthy") break;
    if (i === 39) throw new Error(`Unhealthy container: ${status}`);
    await delay(1000);
  }
  console.log(
    "PASS: Docker build runtime, mapped port, non-root server, bind-mounted SQLite, admin/account flows, online backup, cross-container lock, restart, SIGKILL recovery, recreation, offline restore and healthcheck.",
  );
}
main()
  .catch((error) => {
    // Do not print child-process stdout: setup may contain a one-time initialization token.
    console.error(
      error instanceof Error ? error.message : "Docker verification failed",
    );
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      compose("down", "--remove-orphans");
      // Remove only this test's dedicated bind directory via the image, including UID 1000 files.
      execFileSync(
        "docker",
        [
          "run",
          "--rm",
          "--entrypoint",
          "sh",
          "--mount",
          `type=bind,source=${directory},target=/cleanup`,
          "claimlist:local",
          "-c",
          "find /cleanup -mindepth 1 -delete",
        ],
        { stdio: "ignore" },
      );
      rmSync(directory, { recursive: true, force: true });
    } catch {
      console.error(
        `Test cleanup incomplete; isolated data remains at ${directory}`,
      );
    }
  });
