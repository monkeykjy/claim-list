import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fork } from "node:child_process";
import { Store } from "../src/server/store";
import { digest, hashPassword } from "../src/server/credentials";
import { PARTICIPANT_SESSION_MS } from "../src/server/participants";
import { defaultConfig } from "../src/shared/model";
import { backupDatabase, restoreDatabase } from "../scripts/maintenance";
const uuid = "a0000000-0000-4000-8000-000000000001";
const otherUuid = "b0000000-0000-4000-8000-000000000002";
const anonymous = { ip: "192.168.1.1", uuid };
const input = {
  email: "a@example.com",
  name: "张三",
  password: "12345678",
  confirm: "12345678",
};
function fixture(t: test.TestContext, now = Date.now) {
  const dir = mkdtempSync(join(tmpdir(), "claimlist-accounts-"));
  const path = join(dir, "list.sqlite");
  const store = new Store(path, now);
  t.after(() => {
    if (store.db.open) store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, dir, path };
}
function raw(store: Store) {
  return store.db
    .prepare("SELECT * FROM items ORDER BY sequence")
    .all() as Record<string, unknown>[];
}
function register(store: Store, email = input.email, browser = uuid) {
  return store.participants.authenticate({ ...input, email }, browser, true);
}
test("真实 v1 升级逐字段保留、幂等、旧备份恢复与迁移失败回滚", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "claimlist-v1-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "old.sqlite");
  const old = new Database(path);
  old.exec(readFileSync(join(process.cwd(), "tests/fixtures/v1.sql"), "utf8"));
  old
    .prepare("INSERT INTO settings VALUES (1,?,NULL,?)")
    .run(hashPassword("12345678"), JSON.stringify(defaultConfig));
  old
    .prepare("INSERT INTO sessions VALUES (?,?)")
    .run(digest("old-session"), Date.now() + 100000);
  old.exec(
    `INSERT INTO items VALUES (4,'old','旧任务','历史姓名','192.168.1.1','${uuid}',100,200,50,200,8)`,
  );
  const before = old.prepare("SELECT * FROM items").all();
  const snapshot = join(dir, "v1-backup.sqlite");
  await backupDatabase(path, snapshot);
  assert.equal(old.pragma("user_version", { simple: true }), 1);
  old.close();
  const store = new Store(path);
  assert.equal(store.db.pragma("user_version", { simple: true }), 2);
  assert.deepEqual(
    raw(store).map(({ owner_account_id, ...row }) => {
      assert.equal(owner_account_id, null);
      return row;
    }),
    before,
  );
  assert(store.authenticated("old-session"));
  store.login("12345678");
  store.migrate();
  assert.equal(raw(store).length, 1);
  store.close();
  await restoreDatabase(path, snapshot);
  const restored = new Store(path);
  assert(!restored.authenticated("old-session"));
  assert.deepEqual(
    raw(restored).map(({ owner_account_id, ...row }) => {
      assert.equal(owner_account_id, null);
      return row;
    }),
    before,
  );
  restored.login("12345678");
  restored.close();
  const brokenPath = join(dir, "broken.sqlite");
  const broken = new Database(brokenPath);
  broken.exec(
    readFileSync(join(process.cwd(), "tests/fixtures/v1.sql"), "utf8"),
  );
  broken.exec("CREATE TABLE participant_sessions (conflict TEXT)");
  assert.throws(() => new Store(brokenPath));
  assert.equal(broken.pragma("user_version", { simple: true }), 1);
  assert.equal(
    broken
      .prepare(
        "SELECT name FROM sqlite_master WHERE name='participant_accounts'",
      )
      .get(),
    undefined,
  );
  broken.close();
  await assert.rejects(restoreDatabase(path, brokenPath));
  const untouched = new Store(path);
  assert.equal(raw(untouched)[0].title, "旧任务");
  untouched.close();
});
test("注册校验、邮箱唯一、同名、UUID 绑定保留历史且不可转移，失败全部回滚", (t) => {
  const { store } = fixture(t);
  store.addBatch("进行中\n已完成\n不同浏览器");
  const ids = raw(store).map((r) => String(r.id));
  store.claim(ids[0], "历史甲", anonymous);
  store.claim(ids[1], "历史乙", anonymous);
  store.complete(ids[1], anonymous);
  store.claim(ids[2], "其他人", { ...anonymous, uuid: otherUuid });
  const before = raw(store);
  for (const patch of [
    { password: "1234567", confirm: "1234567" },
    { confirm: "wrong" },
    { name: " " },
    { email: "invalid" },
  ])
    assert.throws(() =>
      store.participants.authenticate({ ...input, ...patch }, uuid, true),
    );
  assert.throws(() => register(store, input.email, ""));
  const a = register(store, " A@Example.com ");
  assert.equal(a.boundCount, 2);
  raw(store)
    .slice(0, 2)
    .forEach((row, i) =>
      assert.deepEqual(row, {
        ...before[i],
        owner_account_id: a.participant.id,
        revision: Number(before[i].revision) + 1,
      }),
    );
  assert.equal(raw(store)[2].owner_account_id, null);
  assert.throws(() => register(store), /已注册/);
  assert.equal(
    store.participants.authenticate(input, uuid, false).boundCount,
    0,
  );
  assert.throws(
    () =>
      store.participants.authenticate(
        { ...input, password: "wrongpwd" },
        uuid,
        false,
      ),
    /不正确/,
  );
  const b = register(store, "b@example.com");
  assert.equal(b.boundCount, 0);
  assert.equal(raw(store)[0].owner_account_id, a.participant.id);
  store.addBatch("回滚任务");
  store.claim(String(raw(store)[3].id), "张三", anonymous);
  store.db.exec(
    "CREATE TRIGGER fail_binding BEFORE UPDATE OF owner_account_id ON items BEGIN SELECT RAISE(ABORT,'binding failed'); END",
  );
  const count = store.db
    .prepare("SELECT count(*) n FROM participant_sessions")
    .get();
  assert.throws(
    () => register(store, "rollback@example.com"),
    /binding failed/,
  );
  assert.throws(
    () => store.participants.authenticate(input, uuid, false),
    /binding failed/,
  );
  assert.equal(
    store.db
      .prepare(
        "SELECT id FROM participant_accounts WHERE email='rollback@example.com'",
      )
      .get(),
    undefined,
  );
  assert.deepEqual(
    store.db.prepare("SELECT count(*) n FROM participant_sessions").get(),
    count,
  );
  assert.equal(raw(store)[3].owner_account_id, null);
});
test("账号与匿名权限矩阵、认领身份切换、管理员纠错与数据库约束", (t) => {
  const { store } = fixture(t);
  const a = register(store);
  const b = register(store, "b@example.com");
  const owner = { ip: "different", uuid: otherUuid, participantToken: a.token };
  store.addBatch("账号任务\n匿名任务\n待认领");
  const ids = raw(store).map((r) => String(r.id));
  store.claim(ids[0], "伪造姓名", owner, a.participant.id);
  assert.equal(raw(store)[0].claimant, input.name);
  assert.throws(() => store.claim(ids[2], "姓名", owner), /登录状态/);
  assert.throws(
    () => store.claim(ids[2], "姓名", anonymous, a.participant.id),
    /登录状态/,
  );
  store.claim(ids[1], "匿名", anonymous);
  for (const identity of [
    anonymous,
    { ...owner, participantToken: "" },
    { ...owner, participantToken: b.token },
  ]) {
    assert.throws(() => store.complete(ids[0], identity), /所属账号/);
    assert.equal(
      store.list(identity).items.find((i) => i.id === ids[0])!.canComplete,
      false,
    );
  }
  assert.throws(
    () => store.complete(ids[1], { ip: "other", uuid: otherUuid }),
    /不符合/,
  );
  assert(
    store.list({ ip: "other", uuid }).items.find((i) => i.id === ids[1])!
      .canComplete,
  );
  assert(
    store
      .list({ ...anonymous, uuid: otherUuid, participantToken: b.token })
      .items.find((i) => i.id === ids[1])!.canComplete,
  );
  assert(store.list(owner).items.find((i) => i.id === ids[0])!.canComplete);
  store.complete(ids[0], { ...owner, ip: "third-device", uuid });
  const completed = raw(store)[0].completed_at;
  store.complete(ids[0], owner);
  assert.equal(raw(store)[0].completed_at, completed);
  const edit = (op: string, value?: string) =>
    store.edit(ids[0], raw(store)[0].revision, op, value);
  edit("name", "更名");
  edit("reopen");
  assert.equal(raw(store)[0].owner_account_id, a.participant.id);
  edit("finish");
  edit("release");
  assert.equal(raw(store)[0].owner_account_id, null);
  assert.throws(() =>
    store.db
      .prepare("UPDATE items SET owner_account_id=? WHERE id=?")
      .run(a.participant.id, ids[0]),
  );
  assert.throws(() =>
    store.db
      .prepare("UPDATE items SET owner_account_id='missing' WHERE id=?")
      .run(ids[1]),
  );
  const publicJson = JSON.stringify(store.list(owner));
  for (const secret of [
    input.email,
    "password_hash",
    "token_hash",
    a.token,
    "owner_account_id",
  ])
    assert(!publicJson.includes(secret));
});
test("独立会话、退出和到期、参与者重置与管理员重置隔离、限流分域", (t) => {
  let now = 1000;
  const { store } = fixture(t, () => now);
  const admin = store.initialize(store.prepareSetup(), "12345678");
  const a = register(store);
  const a2 = store.participants.authenticate(input, otherUuid, false);
  const b = register(store, "b@example.com");
  assert(!store.authenticated(a.token));
  assert.equal(store.participants.current(admin), null);
  store.participants.logout(a2.token);
  assert.equal(store.participants.current(a2.token), null);
  assert(store.participants.current(a.token));
  const a3 = store.participants.authenticate(input, otherUuid, false);
  const b2 = store.participants.authenticate(
    { ...input, email: "b@example.com" },
    otherUuid,
    false,
  );
  store.addBatch("重置保留归属");
  store.claim(
    String(raw(store)[0].id),
    "伪造",
    { ...anonymous, participantToken: a.token },
    a.participant.id,
  );
  const ownedBefore = raw(store);
  assert.throws(
    () =>
      store.authorized(a.token, () =>
        store.participants.reset(a.participant.id, "87654321", "87654321"),
      ),
    /管理会话/,
  );
  assert.throws(
    () =>
      store.authorized(admin, () =>
        store.participants.reset(a.participant.id, "1234567", "1234567"),
      ),
    /8/,
  );
  assert.throws(
    () =>
      store.authorized(admin, () =>
        store.participants.reset("missing", "87654321", "87654321"),
      ),
    /不存在/,
  );
  for (let i = 0; i < 10; i++) {
    store.throttle(input.email, "participant-login-account");
    store.throttle(anonymous.ip, "participant-login-ip");
  }
  store.throttle(anonymous.ip);
  store.throttle(anonymous.ip, "participant-register-ip");
  assert.throws(
    () => store.throttle(anonymous.ip, "participant-login-ip"),
    /频繁/,
  );
  store.authorized(admin, () =>
    store.participants.reset(a.participant.id, "87654321", "87654321"),
  );
  store.throttle(input.email, "participant-login-account");
  assert.equal(store.participants.current(a.token), null);
  assert.equal(store.participants.current(a3.token), null);
  assert(store.participants.current(b2.token));
  assert.deepEqual(raw(store), ownedBefore);
  assert(store.participants.current(b.token));
  assert(store.authenticated(admin));
  assert.throws(
    () => store.participants.authenticate(input, uuid, false),
    /不正确/,
  );
  const reset = store.participants.authenticate(
    { ...input, password: "87654321" },
    uuid,
    false,
  );
  store.resetPassword("abcdefgh");
  assert(!store.authenticated(admin));
  assert(store.participants.current(reset.token));
  assert.throws(
    () => store.throttle(anonymous.ip, "participant-login-ip"),
    /频繁/,
  );
  now += PARTICIPANT_SESSION_MS;
  assert.equal(store.participants.current(reset.token), null);
  store.addBatch("过期认领");
  assert.throws(
    () =>
      store.claim(
        String(raw(store)[1].id),
        "张三",
        { ...anonymous, participantToken: reset.token },
        reset.participant.id,
      ),
    /登录状态/,
  );
  assert.equal(raw(store)[1].claimant, null);
});
test("v2 备份恢复保留账号归属与密码，撤销两类会话，拒绝未来版本", async (t) => {
  const { store, path, dir } = fixture(t);
  const admin = store.initialize(store.prepareSetup(), "12345678");
  store.addBatch("账号备份");
  store.claim(String(raw(store)[0].id), "历史", anonymous);
  const a = register(store);
  const before = raw(store);
  const snapshot = join(dir, "v2.sqlite");
  await backupDatabase(path, snapshot);
  store.close();
  await restoreDatabase(path, snapshot);
  const restored = new Store(path);
  assert.deepEqual(raw(restored), before);
  assert(!restored.authenticated(admin));
  assert.equal(restored.participants.current(a.token), null);
  restored.participants.authenticate(input, uuid, false);
  restored.close();
  const future = new Database(snapshot);
  future.pragma("user_version=3");
  future.close();
  await assert.rejects(restoreDatabase(path, snapshot), /版本/);
  const untouched = new Store(path);
  assert.deepEqual(raw(untouched), before);
  untouched.close();
});
async function race(path: string, actions: Record<string, unknown>[]) {
  const children = actions.map((action) =>
    fork(
      join(process.cwd(), "tests/fixtures/account-race.ts"),
      [path, JSON.stringify(action)],
      {
        execArgv: ["--import", "tsx", "--conditions=react-server"],
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      },
    ),
  );
  const ready = children.map(
    (child) =>
      new Promise<void>((resolve) => child.once("message", () => resolve())),
  );
  const results = children.map(
    (child) =>
      new Promise<{ ok: boolean; boundCount?: number }>((resolve, reject) => {
        child.on("message", (message) => {
          if (message !== "ready")
            resolve(message as { ok: boolean; boundCount?: number });
        });
        child.on("error", reject);
        child.on("exit", (code) => {
          if (code) reject(new Error(`child ${code}`));
        });
      }),
  );
  await Promise.all(ready);
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
test("多进程并发注册与登录绑定、绑定/完成事务顺序及释放/认领竞争", async (t) => {
  const { store, path } = fixture(t);
  const a = register(store);
  register(store, "b@example.com");
  const same = await race(
    path,
    [1, 2].map(() => ({ action: "register", email: "race@example.com" })),
  );
  assert.equal(same.filter((r) => r.ok).length, 1);
  store.addBatch("并发绑定");
  const id = String(raw(store)[0].id);
  store.claim(id, "历史", anonymous);
  const login = (email: string) => ({ action: "login", email });
  const claims = await race(path, [login(input.email), login("b@example.com")]);
  assert.equal(
    claims.reduce((n, r) => n + (r.boundCount || 0), 0),
    1,
  );
  const release = () => store.edit(id, raw(store)[0].revision, "release");
  release();
  store.claim(id, "历史", anonymous);
  const sameAccount = await race(path, [
    login(input.email),
    login(input.email),
  ]);
  assert.equal(
    sameAccount.reduce((n, r) => n + (r.boundCount || 0), 0),
    1,
  );
  assert.throws(() => store.complete(id, anonymous), /所属账号/);
  release();
  store.claim(id, "历史", anonymous);
  store.complete(id, anonymous);
  const finished = raw(store)[0].completed_at;
  store.participants.authenticate(input, uuid, false);
  assert.equal(raw(store)[0].completed_at, finished);
  release();
  store.claim(id, "历史", anonymous);
  await race(path, [login(input.email), { action: "complete", id }]);
  assert.equal(raw(store)[0].owner_account_id, a.participant.id);
  await race(path, [login(input.email), { action: "release", id }]);
  assert.equal(raw(store)[0].claimant, null);
  await race(path, [login(input.email), { action: "claim", id }]);
  assert.equal(raw(store)[0].claimant, "历史");
  assert(
    [null, a.participant.id].includes(
      raw(store)[0].owner_account_id as string | null,
    ),
  );
});
