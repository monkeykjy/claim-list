import "server-only";
import type Database from "better-sqlite3";
import { randomBytes, randomUUID } from "node:crypto";
import { AppError, password, text } from "./errors";
import { digest, hashPassword, matches } from "./credentials";
import type { Participant } from "../shared/model";
export const PARTICIPANT_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export function normalizeEmail(value: unknown) {
  const email = text(value, "邮箱", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email))
    throw new AppError(400, "请输入完整的邮箱地址");
  return email;
}
export class Participants {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => number,
  ) {}
  current(token = ""): Participant | null {
    if (!token) return null;
    return (
      (this.db
        .prepare(
          `SELECT a.id,a.name FROM participant_sessions s
      JOIN participant_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?`,
        )
        .get(digest(token), this.now()) as Participant | undefined) || null
    );
  }
  authenticate(
    input: Record<string, unknown>,
    uuid: string,
    register: boolean,
  ) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        uuid,
      )
    )
      throw new AppError(400, "缺少有效浏览器标识，请刷新后重试");
    const email = normalizeEmail(input.email);
    const secret = password(input.password);
    if (register && secret !== input.confirm)
      throw new AppError(400, "两次密码不一致");
    const name = register ? text(input.name, "姓名", 60) : "";
    const hash = register ? hashPassword(secret) : "";
    return this.db
      .transaction(() => {
        let account = this.db
          .prepare(
            "SELECT id,name,password_hash FROM participant_accounts WHERE email=?",
          )
          .get(email) as (Participant & { password_hash: string }) | undefined;
        if (register) {
          if (account) throw new AppError(409, "该邮箱已注册，请登录");
          account = { id: randomUUID(), name, password_hash: hash };
          this.db
            .prepare(
              "INSERT INTO participant_accounts (id,email,name,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)",
            )
            .run(account.id, email, name, hash, this.now(), this.now());
        } else if (!account || !matches(secret, account.password_hash)) {
          throw new AppError(403, "邮箱或密码不正确");
        }
        const participant = { id: account!.id, name: account!.name };
        const token = randomBytes(32).toString("base64url");
        this.db
          .prepare("DELETE FROM participant_sessions WHERE expires_at<=?")
          .run(this.now());
        this.db
          .prepare(
            "INSERT INTO participant_sessions (token_hash,account_id,expires_at) VALUES (?,?,?)",
          )
          .run(
            digest(token),
            participant.id,
            this.now() + PARTICIPANT_SESSION_MS,
          );
        const boundCount = this.db
          .prepare(
            `UPDATE items SET owner_account_id=?,revision=revision+1
        WHERE claimant IS NOT NULL AND claim_uuid=? AND owner_account_id IS NULL`,
          )
          .run(participant.id, uuid).changes;
        return { token, participant, boundCount };
      })
      .immediate();
  }
  logout(token: string) {
    this.db
      .prepare("DELETE FROM participant_sessions WHERE token_hash=?")
      .run(digest(token));
  }
  // Call only inside Store.authorized, keeping authorization and changes in one transaction.
  search(query: unknown) {
    const term = text(query, "查询内容", 254, true);
    return this.db
      .prepare(
        `SELECT id,email,name FROM participant_accounts
      WHERE instr(email,?)>0 OR instr(name,?)>0 ORDER BY email LIMIT 50`,
      )
      .all(term.toLowerCase(), term) as (Participant & { email: string })[];
  }
  reset(id: unknown, next: unknown, confirm: unknown) {
    if (next !== confirm) throw new AppError(400, "两次密码不一致");
    const hash = hashPassword(next);
    const account = this.db
      .prepare("SELECT email FROM participant_accounts WHERE id=?")
      .get(text(id, "账号标识", 100)) as { email: string } | undefined;
    if (!account) throw new AppError(404, "账号不存在，请重新查询");
    this.db
      .prepare(
        "UPDATE participant_accounts SET password_hash=?,updated_at=? WHERE id=?",
      )
      .run(hash, this.now(), id);
    this.db
      .prepare("DELETE FROM participant_sessions WHERE account_id=?")
      .run(id);
    this.db
      .prepare("DELETE FROM attempts WHERE key=?")
      .run(`participant-login-account:${digest(account.email)}`);
  }
}
