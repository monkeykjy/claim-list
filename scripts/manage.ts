process.umask(0o077);
import { emitKeypressEvents } from "node:readline";
import { Store } from "../src/server/store";
import { password } from "../src/server/errors";
import { runtimePath } from "./runtime-lock";
import { backupDatabase, restoreDatabase } from "./maintenance";

function hiddenInput(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      "密码重置必须在交互式终端中运行，不接受命令行参数或管道密码",
    );
  return new Promise((resolve, reject) => {
    let value = "";
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const clean = () => {
      process.stdin.removeListener("keypress", onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onKey = (str: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        clean();
        reject(new Error("已取消，原密码未改变"));
      } else if (key.name === "return" || key.name === "enter") {
        clean();
        resolve(value);
      } else if (key.name === "backspace")
        value = [...value].slice(0, -1).join("");
      else if (!key.ctrl && str && !str.includes("\u001b")) value += str;
    };
    process.stdin.on("keypress", onKey);
    process.stdout.write(prompt);
  });
}
async function main() {
  const [command, file, confirmation] = process.argv.slice(2);
  const path = runtimePath();
  if (command === "backup") {
    if (!file) throw new Error("用法：pnpm db:backup /备份目录/新文件.sqlite");
    console.log(`备份完成：${await backupDatabase(path, file)}`);
    return;
  }
  if (command === "restore") {
    if (!file || confirmation !== "--confirm")
      throw new Error(
        "先停止应用，再运行：pnpm db:restore /备份文件.sqlite --confirm",
      );
    const rollback = await restoreDatabase(path, file);
    console.log(
      `恢复完成，所有管理员和参与者会话已失效。${rollback ? `恢复前备份：${rollback}` : ""}`,
    );
    return;
  }
  const store = new Store(path);
  try {
    if (command === "setup") {
      console.log("一次性初始化口令（请私下交付管理员，不要提交到 Git）：");
      console.log(store.prepareSetup());
    } else if (command === "password") {
      if (!store.initialized())
        throw new Error("站点尚未初始化，请先运行 pnpm setup");
      const first = password(
        await hiddenInput("新管理密码（8–128 字符，输入不可见）："),
      );
      const second = await hiddenInput("再次输入新密码：");
      if (first !== second) throw new Error("两次密码不一致，原密码未改变");
      store.resetPassword(first);
      console.log(
        "密码已重置，旧管理会话全部失效，参与者账号与会话、清单和认领数据保留。",
      );
    } else if (command === "migrate")
      console.log(
        `数据库迁移完成，当前版本：${store.db.pragma("user_version", { simple: true })}`,
      );
    else throw new Error("未知维护命令");
  } finally {
    store.close();
  }
}
main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
