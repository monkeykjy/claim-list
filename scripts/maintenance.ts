import "server-only";
import Database from "better-sqlite3";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/store";
import { acquireLock } from "./runtime-lock";
export async function backupDatabase(database: string, destination: string) {
  if (!existsSync(database)) throw new Error("数据库不存在，不能备份空站点");
  const target = resolve(destination);
  if (target === resolve(database) || existsSync(target))
    throw new Error("备份目标必须是尚不存在的新文件");
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  const source = new Database(database, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    await source.backup(temporary);
    chmodSync(temporary, 0o600);
    renameSync(temporary, target);
  } finally {
    source.close();
    rmSync(temporary, { force: true });
  }
  return target;
}
export async function restoreDatabase(database: string, source: string) {
  if (resolve(source) === resolve(database))
    throw new Error("不能用当前数据库覆盖自身");
  const release = acquireLock(database);
  const staged = `${database}.${randomUUID()}.restore`;
  try {
    const check = new Database(resolve(source), {
      readonly: true,
      fileMustExist: true,
    });
    try {
      if (check.pragma("integrity_check", { simple: true }) !== "ok")
        throw new Error("备份完整性检查失败");
      const version = check.pragma("user_version", { simple: true }) as number;
      if (version !== 1 && version !== 2)
        throw new Error("备份数据库版本不受当前应用支持");
      check
        .prepare("SELECT password_hash,config FROM settings WHERE id=1")
        .get();
      check.prepare("SELECT id,title,claim_uuid FROM items").all();
      if ((check.pragma("foreign_key_check") as unknown[]).length)
        throw new Error("备份外键检查失败");
      await check.backup(staged);
    } finally {
      check.close();
    }
    chmodSync(staged, 0o600);
    const restored = new Store(staged);
    try {
      restored.db
        .prepare("SELECT id,email,name,password_hash FROM participant_accounts")
        .all();
      restored.db.prepare("SELECT owner_account_id FROM items").all();
      if ((restored.db.pragma("foreign_key_check") as unknown[]).length)
        throw new Error("恢复外键检查失败");
      restored.db.exec(
        "DELETE FROM sessions; DELETE FROM participant_sessions; DELETE FROM attempts;",
      );
      restored.db.pragma("wal_checkpoint(TRUNCATE)");
    } finally {
      restored.close();
    }
    let rollback: string | undefined;
    if (existsSync(database))
      rollback = await backupDatabase(
        database,
        `${database}.before-restore-${Date.now()}.sqlite`,
      );
    // Only replace after the staged database and the rollback snapshot are ready.
    rmSync(`${database}-wal`, { force: true });
    rmSync(`${database}-shm`, { force: true });
    renameSync(staged, database);
    return rollback;
  } finally {
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(staged + suffix, { force: true });
    release();
  }
}
