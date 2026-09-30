import "server-only";
import Database from "better-sqlite3";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { digest, hashPassword, matches } from "./credentials";
import { Participants } from "./participants";
import { AppError, password, text } from "./errors";
import {
  defaultConfig,
  limits,
  type Config,
  type Identity,
  type Item,
  type ListData,
} from "../shared/model";

type Row = {
  id: string;
  title: string;
  claimant: string | null;
  claim_ip: string | null;
  claim_uuid: string | null;
  claimed_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
  revision: number;
  owner_account_id: string | null;
};
type Settings = {
  password_hash: string | null;
  init_hash: string | null;
  config: string;
};
export const SESSION_MS = 24 * 60 * 60 * 1000;
export class Store {
  readonly db: Database.Database;
  readonly participants: Participants;
  constructor(
    public readonly path: string,
    private readonly now = Date.now,
  ) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    try {
      this.migrate();
    } catch (error) {
      this.db.close();
      throw error;
    }
    this.participants = new Participants(this.db, this.now);
    if (path !== ":memory:") chmodSync(path, 0o600);
  }
  migrate() {
    this.db
      .transaction(() => {
        const version = this.db.pragma("user_version", {
          simple: true,
        }) as number;
        if (version > 2)
          throw new Error("数据库版本高于应用版本，请使用匹配的应用或恢复备份");
        if (version === 0) {
          this.db.exec(`
          CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), password_hash TEXT, init_hash TEXT, config TEXT NOT NULL);
          CREATE TABLE items (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL UNIQUE COLLATE BINARY CHECK(length(title) BETWEEN 1 AND 200),
            claimant TEXT, claim_ip TEXT, claim_uuid TEXT, claimed_at INTEGER, completed_at INTEGER,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
            CHECK ((claimant IS NULL AND claim_ip IS NULL AND claim_uuid IS NULL AND claimed_at IS NULL AND completed_at IS NULL)
              OR (claimant IS NOT NULL AND length(claimant) BETWEEN 1 AND 60 AND claim_ip IS NOT NULL AND claim_uuid IS NOT NULL AND claimed_at IS NOT NULL))
          );
          CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
          CREATE TABLE attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
          PRAGMA user_version = 1;
        `);
          this.db
            .prepare("INSERT INTO settings (id,config) VALUES (1,?)")
            .run(JSON.stringify(defaultConfig));
        }
        if (version < 2) {
          this.db.exec(`
            CREATE TABLE participant_accounts (
              id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
              password_hash TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
            );
            CREATE TABLE participant_sessions (
              token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES participant_accounts(id), expires_at INTEGER NOT NULL
            );
            CREATE INDEX participant_sessions_account ON participant_sessions(account_id);
            CREATE INDEX participant_sessions_expiry ON participant_sessions(expires_at);
            ALTER TABLE items ADD COLUMN owner_account_id TEXT REFERENCES participant_accounts(id)
              CHECK(owner_account_id IS NULL OR claimant IS NOT NULL);
            CREATE INDEX items_unbound_uuid ON items(claim_uuid) WHERE owner_account_id IS NULL AND claimant IS NOT NULL;
            PRAGMA user_version = 2;
          `);
        }
      })
      .immediate();
  }
  settings() {
    return this.db
      .prepare("SELECT * FROM settings WHERE id=1")
      .get() as Settings;
  }
  initialized() {
    return !!this.settings().password_hash;
  }
  prepareSetup() {
    return this.db
      .transaction(() => {
        if (this.initialized())
          throw new AppError(409, "站点已初始化，请使用密码重置命令");
        const token = randomBytes(32).toString("base64url");
        this.db
          .prepare("UPDATE settings SET init_hash=? WHERE id=1")
          .run(digest(token));
        return token;
      })
      .immediate();
  }
  throttle(ip: string, namespace = "admin") {
    this.db
      .transaction(() => {
        const now = this.now();
        this.db.prepare("DELETE FROM attempts WHERE expires_at<=?").run(now);
        const key = `${namespace}:${digest(ip)}`;
        const row = this.db
          .prepare("SELECT count FROM attempts WHERE key=?")
          .get(key) as { count: number } | undefined;
        if (row && row.count >= 10)
          throw new AppError(429, "尝试过于频繁，请在 15 分钟后重试");
        this.db
          .prepare(
            "INSERT INTO attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
          )
          .run(key, now + 15 * 60 * 1000);
      })
      .immediate();
  }
  private createSession() {
    const token = randomBytes(32).toString("base64url");
    this.db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(this.now());
    this.db
      .prepare("INSERT INTO sessions VALUES (?,?)")
      .run(digest(token), this.now() + SESSION_MS);
    return token;
  }
  initialize(token: unknown, value: unknown) {
    const hashed = hashPassword(password(value));
    return this.db
      .transaction(() => {
        const settings = this.settings();
        if (settings.password_hash)
          throw new AppError(409, "站点已经初始化，请登录");
        if (
          typeof token !== "string" ||
          !settings.init_hash ||
          digest(token) !== settings.init_hash
        )
          throw new AppError(
            403,
            "初始化口令不正确或未生成，请联系服务器维护者",
          );
        this.db
          .prepare(
            "UPDATE settings SET password_hash=?, init_hash=NULL WHERE id=1",
          )
          .run(hashed);
        return this.createSession();
      })
      .immediate();
  }
  login(value: unknown) {
    const input = password(value);
    return this.db
      .transaction(() => {
        const hash = this.settings().password_hash;
        if (!hash || !matches(input, hash))
          throw new AppError(403, "管理密码不正确");
        return this.createSession();
      })
      .immediate();
  }
  authenticated(token: string) {
    return (
      !!token &&
      !!this.db
        .prepare("SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?")
        .get(digest(token), this.now())
    );
  }
  authorized<T>(token: string, action: () => T): T {
    return this.db
      .transaction(() => {
        if (!this.authenticated(token))
          throw new AppError(401, "管理会话已失效，请重新登录");
        return action();
      })
      .immediate();
  }
  logout(token: string) {
    this.db
      .prepare("DELETE FROM sessions WHERE token_hash=?")
      .run(digest(token));
  }
  changePassword(token: string, old: unknown, next: unknown) {
    this.authorized(token, () => {
      const hashed = hashPassword(password(next));
      if (!matches(password(old), this.settings().password_hash!))
        throw new AppError(403, "当前密码不正确");
      this.db
        .prepare("UPDATE settings SET password_hash=? WHERE id=1")
        .run(hashed);
      this.db.exec("DELETE FROM sessions");
    });
  }
  resetPassword(value: unknown) {
    const hashed = hashPassword(password(value));
    this.db
      .transaction(() => {
        if (!this.initialized())
          throw new AppError(409, "站点尚未初始化，请先运行 pnpm setup");
        this.db
          .prepare(
            "UPDATE settings SET password_hash=?,init_hash=NULL WHERE id=1",
          )
          .run(hashed);
        this.db.exec(
          "DELETE FROM sessions; DELETE FROM attempts WHERE key LIKE 'admin:%' OR instr(key, ':')=0;",
        );
      })
      .immediate();
  }
  private canComplete(row: Row, identity: Identity, accountId?: string) {
    return row.owner_account_id
      ? row.owner_account_id === accountId
      : (!!identity.ip && row.claim_ip === identity.ip) ||
          (!!identity.uuid && row.claim_uuid === identity.uuid);
  }
  list(identity: Identity): ListData {
    return this.db.transaction(() => this.listSnapshot(identity))();
  }
  private listSnapshot(identity: Identity): ListData {
    const participant = this.participants.current(identity.participantToken);
    const rows = this.db
      .prepare(
        "SELECT * FROM items ORDER BY completed_at IS NOT NULL, sequence",
      )
      .all() as Row[];
    return {
      participant,
      config: JSON.parse(this.settings().config),
      items: rows.map((row): Item => ({
        id: row.id,
        title: row.title,
        claimant: row.claimant,
        claimedAt: row.claimed_at,
        completedAt: row.completed_at,
        createdAt: row.created_at,
        revision: row.revision,
        canComplete:
          !!row.claimant &&
          !row.completed_at &&
          this.canComplete(row, identity, participant?.id),
        accountBound: !!row.owner_account_id,
        isMine: row.owner_account_id
          ? row.owner_account_id === participant?.id
          : !!identity.uuid && row.claim_uuid === identity.uuid,
      })),
    };
  }
  private row(id: unknown) {
    if (typeof id !== "string") throw new AppError(400, "条目标识不正确");
    const row = this.db.prepare("SELECT * FROM items WHERE id=?").get(id) as
      Row | undefined;
    if (!row) throw new AppError(404, "该条目已不存在");
    return row;
  }
  addBatch(input: unknown) {
    if (typeof input !== "string" || input.length > 50000)
      throw new AppError(400, "批量输入最多 50000 个字符");
    const lines = input
      .split(/\r\n|\r|\n/)
      .map((title, index) => ({ title: title.trim(), line: index + 1 }))
      .filter(({ title }) => title);
    if (!lines.length) throw new AppError(400, "请输入至少一个条目");
    if (lines.length > limits.batch)
      throw new AppError(400, `每批最多 ${limits.batch} 个条目`);
    lines.forEach(({ title, line }) =>
      text(title, `第 ${line} 行标题`, limits.title),
    );
    return this.db
      .transaction(() => {
        const groups = new Map<string, number[]>();
        for (const { title, line } of lines)
          groups.set(title, [...(groups.get(title) || []), line]);
        const existing = this.db.prepare("SELECT 1 FROM items WHERE title=?");
        const conflicts = [...groups]
          .filter(
            ([title, positions]) => positions.length > 1 || existing.get(title),
          )
          .map(([title, positions]) => ({ title, lines: positions }));
        if (conflicts.length)
          throw new AppError(409, "存在重复标题，本批次未添加", conflicts);
        const insert = this.db.prepare(
          "INSERT INTO items (id,title,created_at,updated_at) VALUES (?,?,?,?)",
        );
        const now = this.now();
        for (const { title } of lines)
          insert.run(randomUUID(), title, now, now);
        return lines.length;
      })
      .immediate();
  }
  claim(
    id: unknown,
    name: unknown,
    identity: Identity,
    expectedAccountId: unknown = null,
  ) {
    if (!identity.uuid || !identity.ip)
      throw new AppError(400, "无法获取浏览器或网络身份，请刷新后重试");
    this.db
      .transaction(() => {
        const participant = this.participants.current(
          identity.participantToken,
        );
        if ((participant?.id || null) !== expectedAccountId)
          throw new AppError(
            401,
            "登录状态已变化，请刷新后重新登录或选择匿名认领",
            { code: "PARTICIPANT_CHANGED" },
          );
        const claimant = participant?.name || text(name, "姓名", limits.name);
        const row = this.row(id);
        if (row.claimant)
          throw new AppError(409, `该条目已被${row.claimant}认领`, {
            code: "ALREADY_CLAIMED",
          });
        const now = this.now();
        const result = this.db
          .prepare(
            "UPDATE items SET owner_account_id=?,claimant=?,claim_ip=?,claim_uuid=?,claimed_at=?,updated_at=?,revision=revision+1 WHERE id=? AND claimant IS NULL",
          )
          .run(
            participant?.id || null,
            claimant,
            identity.ip,
            identity.uuid,
            now,
            now,
            row.id,
          );
        if (result.changes !== 1)
          throw new AppError(
            409,
            `该条目已被${this.row(row.id).claimant || "其他人"}认领`,
            { code: "ALREADY_CLAIMED" },
          );
      })
      .immediate();
  }
  complete(id: unknown, identity: Identity) {
    this.db
      .transaction(() => {
        const row = this.row(id);
        if (!row.claimant) throw new AppError(409, "待认领条目不能完成");
        const participant = this.participants.current(
          identity.participantToken,
        );
        if (!this.canComplete(row, identity, participant?.id))
          throw new AppError(
            403,
            row.owner_account_id
              ? "请登录该条目所属账号后完成"
              : "当前浏览器或网络身份不符合完成条件，请联系管理员",
          );
        if (!row.completed_at)
          this.db
            .prepare(
              "UPDATE items SET completed_at=?,updated_at=?,revision=revision+1 WHERE id=? AND completed_at IS NULL",
            )
            .run(this.now(), this.now(), row.id);
      })
      .immediate();
  }
  edit(id: unknown, revision: unknown, action: string, value?: unknown) {
    this.db
      .transaction(() => {
        const row = this.row(id);
        if (row.revision !== revision)
          throw new AppError(
            409,
            "条目已变化，请核对最新内容后重新编辑；草稿已保留",
          );
        const now = this.now();
        if (action === "delete") {
          this.db.prepare("DELETE FROM items WHERE id=?").run(row.id);
          return;
        }
        if (action === "title") {
          const title = text(value, "标题", limits.title);
          if (/\r|\n/.test(title)) throw new AppError(400, "标题不能包含换行");
          if (
            this.db
              .prepare("SELECT 1 FROM items WHERE title=? AND id<>?")
              .get(title, row.id)
          )
            throw new AppError(409, "标题重复", [{ title, lines: [1] }]);
          this.db
            .prepare(
              "UPDATE items SET title=?,updated_at=?,revision=revision+1 WHERE id=?",
            )
            .run(title, now, row.id);
          return;
        }
        if (!row.claimant) throw new AppError(409, "该条目尚未认领");
        if (action === "name")
          this.db
            .prepare(
              "UPDATE items SET claimant=?,updated_at=?,revision=revision+1 WHERE id=?",
            )
            .run(text(value, "姓名", limits.name), now, row.id);
        else if (action === "release")
          this.db
            .prepare(
              "UPDATE items SET owner_account_id=NULL,claimant=NULL,claim_ip=NULL,claim_uuid=NULL,claimed_at=NULL,completed_at=NULL,updated_at=?,revision=revision+1 WHERE id=?",
            )
            .run(now, row.id);
        else if (action === "reopen" && row.completed_at)
          this.db
            .prepare(
              "UPDATE items SET completed_at=NULL,updated_at=?,revision=revision+1 WHERE id=?",
            )
            .run(now, row.id);
        else if (action === "finish" && !row.completed_at)
          this.db
            .prepare(
              "UPDATE items SET completed_at=?,updated_at=?,revision=revision+1 WHERE id=?",
            )
            .run(now, now, row.id);
        else throw new AppError(409, "当前状态不支持此操作");
      })
      .immediate();
  }
  saveConfig(input: Record<string, unknown>) {
    if (input.base !== this.settings().config)
      throw new AppError(409, "清单文案已变化，请核对最新内容后重试");
    const config: Config = {
      listName: text(input.listName, "清单名称", limits.listName),
      description: text(input.description, "说明", limits.description, true),
      titleLabel: text(input.titleLabel, "标题列名", limits.label),
      claimantLabel: text(input.claimantLabel, "认领人列名", limits.label),
      statusLabel: text(input.statusLabel, "状态列名", limits.label),
    };
    this.db
      .prepare("UPDATE settings SET config=? WHERE id=1")
      .run(JSON.stringify(config));
  }
  close() {
    this.db.close();
  }
}
let singleton: Store | undefined;
export function databasePath() {
  return resolve(
    /* turbopackIgnore: true */ process.env.DATABASE_PATH ||
      "data/claim-list.sqlite",
  );
}
export function getStore() {
  return (singleton ??= new Store(databasePath()));
}
