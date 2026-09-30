import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fork } from "node:child_process";
import { Store, SESSION_MS } from "../src/server/store";
import { backupDatabase, restoreDatabase } from "../scripts/maintenance";
import { acquireLock } from "../scripts/runtime-lock";
import { clientIp, directOrigin } from "../scripts/network";
const identity = { ip: "192.168.1.10", uuid: "browser-a" };
const pass = "a-valid-test-password";
function fixture(t: test.TestContext, now?: () => number) {
  const dir = mkdtempSync(join(tmpdir(), "claimlist-unit-"));
  const path = join(dir, "list.sqlite");
  const store = new Store(path, now);
  t.after(() => {
    if (store.db.open) store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, path, dir };
}
function id(store: Store) {
  return store.list(identity).items[0].id;
}
function login(store: Store) {
  return store.initialize(store.prepareSetup(), pass);
}

test("精确标题去重、原始行号、整批回滚及空输入", (t) => {
  const { store } = fixture(t);
  assert.equal(store.addBatch("  A  \r\n\rB\n"), 2);
  assert.throws(
    () => store.addBatch("新标题\n A \n"),
    (e) => {
      assert.match((e as Error).message, /重复/);
      assert.deepEqual((e as { details: unknown }).details, [
        { title: "A", lines: [2] },
      ]);
      return true;
    },
  );
  assert.equal(store.list(identity).items.length, 2);
  assert.throws(
    () => store.addBatch("\n C\nC "),
    (e) => {
      assert.deepEqual((e as { details: unknown }).details, [
        { title: "C", lines: [2, 3] },
      ]);
      return true;
    },
  );
  assert.throws(() => store.addBatch(" \n\r "), /至少/);
  store.addBatch("a\nA B\nA  B\nA。");
  assert.equal(store.list(identity).items.length, 6);
  store.db.exec(
    "CREATE TRIGGER fail_batch BEFORE INSERT ON items WHEN NEW.title='失败' BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
  );
  assert.throws(() => store.addBatch("先写入\n失败"));
  assert(!store.list(identity).items.some((i) => i.title === "先写入"));
});

test("完成使用 IP OR UUID，公开字段不暴露身份，重复完成幂等", (t) => {
  let now = 1000;
  const { store } = fixture(t, () => now);
  store.addBatch("任务");
  const item = id(store);
  assert.throws(() => store.complete(item, identity), /待认领/);
  store.claim(item, " 张三 ", identity);
  assert.throws(
    () => store.claim(item, "李四", identity),
    (error) => {
      assert.equal((error as Error).message, "该条目已被张三认领");
      assert.deepEqual((error as { details: unknown }).details, {
        code: "ALREADY_CLAIMED",
      });
      return true;
    },
  );
  assert.throws(
    () => store.complete(item, { ip: "192.168.1.99", uuid: "other" }),
    /不符合/,
  );
  assert(
    store.list({ ip: "192.168.1.99", uuid: identity.uuid }).items[0]
      .canComplete,
  );
  assert(store.list({ ip: identity.ip, uuid: "other" }).items[0].canComplete);
  store.complete(item, { ip: "192.168.1.99", uuid: identity.uuid });
  now = 2000;
  store.complete(item, { ip: identity.ip, uuid: "other" });
  assert.equal(store.list(identity).items[0].completedAt, 1000);
  const publicJson = JSON.stringify(store.list(identity));
  for (const value of [
    "claim_ip",
    "claim_uuid",
    "password_hash",
    identity.ip,
    identity.uuid,
  ])
    assert(!publicJson.includes(value));
  assert.throws(() => store.addBatch("任务"), /重复/);
});

test("管理员更名不转移身份，状态纠错和删除重建", (t) => {
  const { store } = fixture(t);
  store.addBatch("任务\n另一个");
  const item = id(store);
  store.claim(item, "张三", identity);
  const row = () =>
    store.list(identity).items.find((entry) => entry.id === item)!;
  store.edit(item, row().revision, "name", "李四");
  assert.equal(row().claimant, "李四");
  assert(row().canComplete);
  assert.throws(
    () => store.complete(item, { ip: "other", uuid: "other" }),
    /不符合/,
  );
  store.edit(item, row().revision, "title", "新标题");
  assert.equal(row().id, item);
  assert(row().canComplete);
  assert.throws(
    () => store.edit(item, row().revision, "title", "另一个"),
    /重复/,
  );
  assert.throws(() => store.edit(item, 1, "delete"), /已变化/);
  store.edit(item, row().revision, "finish");
  assert(row().completedAt);
  assert.deepEqual(
    store.list(identity).items.map((entry) => entry.title),
    ["另一个", "新标题"],
  );
  store.edit(item, row().revision, "reopen");
  assert.deepEqual(
    store.list(identity).items.map((entry) => entry.title),
    ["新标题", "另一个"],
  );
  assert.equal(row().completedAt, null);
  assert.equal(row().claimant, "李四");
  store.edit(item, row().revision, "finish");
  store.edit(item, row().revision, "release");
  assert.equal(row().claimant, null);
  const raw = store.db
    .prepare("SELECT * FROM items WHERE id=?")
    .get(item) as Record<string, unknown>;
  for (const key of [
    "claimant",
    "claim_ip",
    "claim_uuid",
    "claimed_at",
    "completed_at",
  ])
    assert.equal(raw[key], null);
  assert.throws(() => store.edit(item, row().revision, "finish"), /尚未认领/);
  store.edit(item, row().revision, "delete");
  store.addBatch("新标题");
  const recreated = store
    .list(identity)
    .items.find((i) => i.title === "新标题")!;
  assert.notEqual(recreated.id, item);
  assert.equal(recreated.claimant, null);
});

test("初始化封闭、会话到期退出与改密重置失效、失败保留密码", (t) => {
  let now = 1000;
  const { store } = fixture(t, () => now);
  const token = store.prepareSetup();
  assert.throws(() => store.initialize("wrong", pass), /口令/);
  assert(!store.initialized());
  assert.throws(() => store.initialize(token, "1234567"), /8/);
  assert(!store.initialized());
  const a = store.initialize(token, "12345678");
  store.login("12345678");
  store.changePassword(a, "12345678", pass);
  const initialSession = store.login(pass);
  const b = store.login(pass);
  assert(store.authenticated(initialSession));
  assert.equal(store.settings().init_hash, null);
  assert(!store.settings().password_hash!.includes(pass));
  assert.throws(() => store.initialize(token, pass), /已经/);
  assert.throws(() => store.prepareSetup(), /已初始化/);
  assert.throws(
    () => store.authorized("fake", () => store.addBatch("非法")),
    /失效/,
  );
  store.logout(initialSession);
  assert(!store.authenticated(initialSession));
  assert(store.authenticated(b));
  now += SESSION_MS;
  assert(!store.authenticated(b));
  const c = store.login(pass);
  const d = store.login(pass);
  store.addBatch("保留");
  assert.throws(() => store.changePassword(c, pass, "1234567"), /8/);
  assert(store.authenticated(c));
  store.changePassword(c, pass, "abcdefgh");
  assert(!store.authenticated(c));
  assert(!store.authenticated(d));
  assert.throws(() => store.login(pass), /不正确/);
  const e = store.login("abcdefgh");
  assert.throws(() => store.resetPassword("1234567"), /8/);
  assert(store.authenticated(e));
  store.login("abcdefgh");
  store.resetPassword("87654321");
  assert(!store.authenticated(e));
  assert.throws(() => store.login("abcdefgh"), /不正确/);
  store.login("87654321");
  assert.equal(store.list(identity).items.length, 1);
  assert(store.initialized());
});

test("登录尝试限制持久化且会到期，配置有输入和并发保护", (t) => {
  let now = 1000;
  const { store, path } = fixture(t, () => now);
  for (let i = 0; i < 10; i++) store.throttle(identity.ip);
  assert.throws(() => store.throttle(identity.ip), /15 分钟/);
  const second = new Store(path, () => now);
  assert.throws(() => second.throttle(identity.ip), /15 分钟/);
  second.close();
  now += 15 * 60 * 1000;
  store.throttle(identity.ip);
  const initial = store.list(identity).config;
  store.saveConfig({
    ...initial,
    listName: "开发任务",
    base: JSON.stringify(initial),
  });
  assert.equal(store.list(identity).config.listName, "开发任务");
  assert.throws(
    () => store.saveConfig({ ...initial, base: JSON.stringify(initial) }),
    /已变化/,
  );
});

async function race(path: string, action: string, item: string) {
  const children = [1, 2].map((i) =>
    fork(
      join(process.cwd(), "tests/fixtures/concurrent.ts"),
      [path, action, item, String(i)],
      {
        execArgv: ["--import", "tsx", "--conditions=react-server"],
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      },
    ),
  );
  const results = children.map(
    (child) =>
      new Promise<{ ok: boolean }>((resolve, reject) => {
        child.on("message", (message) => {
          if (message !== "ready") resolve(message as { ok: boolean });
        });
        child.on("error", reject);
        child.on("exit", (code) => {
          if (code) reject(new Error(`child exited ${code}`));
        });
      }),
  );
  await Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolve) => child.once("message", () => resolve())),
    ),
  );
  children.forEach((child) => child.send("go"));
  const values = await Promise.all(results);
  await Promise.all(
    children.map((child) =>
      child.exitCode !== null
        ? Promise.resolve()
        : new Promise<void>((resolve) => child.once("exit", () => resolve())),
    ),
  );
  return values;
}
test("独立进程竞争：同时认领仅一人成功，同时重复批量新增整批唯一", async (t) => {
  const { store, path } = fixture(t);
  store.addBatch("任务");
  const claims = await race(path, "claim", id(store));
  assert.equal(claims.filter((x) => x.ok).length, 1);
  const inserts = await race(path, "batch", "");
  assert.equal(inserts.filter((x) => x.ok).length, 1);
  assert.equal(store.list(identity).items.length, 3);
});

test("备份恢复包括配置和归属；重新打开和迁移保留数据，恢复清除会话", async (t) => {
  const { store, path, dir } = fixture(t);
  const session = login(store);
  store.addBatch("备份任务");
  store.claim(id(store), "张三", identity);
  const before = store.list(identity);
  const backup = join(dir, "backup.sqlite");
  await backupDatabase(path, backup);
  store.addBatch("恢复后应消失");
  store.close();
  await restoreDatabase(path, backup);
  const restored = new Store(path);
  assert.deepEqual(restored.list(identity), before);
  assert(!restored.authenticated(session));
  assert(restored.initialized());
  restored.login(pass);
  restored.migrate();
  assert.deepEqual(restored.list(identity), before);
  restored.close();
  const unlock = acquireLock(path);
  await assert.rejects(restoreDatabase(path, backup), /先停止/);
  unlock();
});

test("只信任显式代理，忽略伪造转发地址并规范化 IP", () => {
  assert.equal(clientIp("::ffff:192.168.1.2", "8.8.8.8", []), "192.168.1.2");
  assert.equal(
    clientIp("127.0.0.1", "192.168.1.2", ["127.0.0.1"]),
    "192.168.1.2",
  );
  assert.throws(() => clientIp("127.0.0.1", "1.1.1.1, 2.2.2.2", ["127.0.0.1"]));
  assert.throws(() => clientIp("127.0.0.1", undefined, ["127.0.0.1"]));
});

test("并发初始化只允许一次，数据库约束拒绝不完整认领状态", async (t) => {
  const { store, path } = fixture(t);
  const results = await race(path, "initialize", store.prepareSetup());
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert(store.initialized());
  assert.equal(store.settings().init_hash, null);
  store.addBatch("状态约束");
  const item = id(store);
  assert.throws(() =>
    store.db.prepare("UPDATE items SET completed_at=1 WHERE id=?").run(item),
  );
  assert.throws(() =>
    store.db
      .prepare("UPDATE items SET claimant='孤立姓名' WHERE id=?")
      .run(item),
  );
  assert.equal(store.list(identity).items[0].claimant, null);
});

test("备份覆盖和损坏恢复被拒绝，原数据保持可读", async (t) => {
  const { store, path, dir } = fixture(t);
  login(store);
  store.addBatch("不能丢失");
  const snapshot = store.list(identity);
  const target = join(dir, "copy.sqlite");
  await backupDatabase(path, target);
  await assert.rejects(backupDatabase(path, target), /尚不存在/);
  store.close();
  const { writeFileSync } = await import("node:fs");
  const bad = join(dir, "bad.sqlite");
  writeFileSync(bad, "not a database");
  await assert.rejects(restoreDatabase(path, bad));
  const reopened = new Store(path);
  assert.deepEqual(reopened.list(identity), snapshot);
  reopened.login(pass);
  reopened.close();
});

test("自动直连来源仅允许本机地址和监听端口", () => {
  const hosts = ["localhost", "127.0.0.1", "192.168.1.20", "::1"];
  assert.equal(
    directOrigin("192.168.1.20:1234", 1234, hosts),
    "http://192.168.1.20:1234",
  );
  assert.equal(
    directOrigin("localhost:1234", 1234, hosts),
    "http://localhost:1234",
  );
  assert.equal(directOrigin("[::1]:1234", 1234, hosts), "http://[::1]:1234");
  for (const host of [
    undefined,
    "evil.example:1234",
    "192.168.1.99:1234",
    "localhost:9999",
    "user@localhost:1234",
    "localhost:1234/path",
  ])
    assert.throws(() => directOrigin(host, 1234, hosts));
});
