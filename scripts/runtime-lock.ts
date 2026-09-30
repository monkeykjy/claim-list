import {
  mkdirSync,
  openSync,
  writeFileSync,
  closeSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
export function runtimePath() {
  return resolve(process.env.DATABASE_PATH || "data/claim-list.sqlite");
}
export function acquireLock(database: string) {
  mkdirSync(dirname(database), { recursive: true, mode: 0o700 });
  const path = `${database}.lock`;
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    let pid: number;
    try {
      pid = JSON.parse(readFileSync(path, "utf8")).pid;
      if (!Number.isInteger(pid) || pid <= 0) throw new Error();
    } catch {
      throw new Error(`锁文件异常，请人工核对服务进程后处理：${path}`);
    }
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") {
        unlinkSync(path);
        return acquireLock(database);
      }
      throw error;
    }
    throw new Error(`数据库正在由进程 ${pid} 使用，请先停止服务`);
  }
  writeFileSync(fd, JSON.stringify({ pid: process.pid }));
  closeSync(fd);
  return () => {
    try {
      unlinkSync(path);
    } catch {
      /* Already cleaned up. */
    }
  };
}
