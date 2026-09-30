"use client";
import { useCallback, useState } from "react";
import { notifyParticipantChange, request, useDraft } from "@/client/browser";
import type { Participant } from "@/shared/model";
import { ItemNotice, type ItemNoticeData } from "./item-notice";
export type AccountMode = "login" | "register" | null;
export function ParticipantPanel({
  participant,
  mode,
  setMode,
  refresh,
  busy,
  setBusy,
}: {
  participant: Participant | null;
  mode: AccountMode;
  setMode: (mode: AccountMode) => void;
  refresh: () => Promise<void>;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const [email, setEmail] = useDraft("participant-email", "");
  const [name, setName] = useDraft("participant-name", "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [notice, setNotice] = useState<ItemNoticeData | null>(null);
  const dismiss = useCallback(() => setNotice(null), []);
  const changeMode = (next: AccountMode) => {
    setPassword("");
    setConfirm("");
    setMode(next);
    setNotice(null);
  };
  async function act(action: "login" | "register" | "logout") {
    if (
      action === "logout" &&
      !window.confirm(
        "确定退出当前账号？退出后仍可匿名使用，账号任务需重新登录后完成。",
      )
    )
      return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await request<{ boundCount?: number }>(
        "/api/participant",
        { action, email, name, password, confirm },
      );
      setPassword("");
      setConfirm("");
      setMode(null);
      setNotice({
        kind: "success",
        message:
          action === "logout"
            ? "已退出账号，可继续匿名使用"
            : result.boundCount
              ? `已将当前浏览器认领的 ${result.boundCount} 个任务关联到你的账号`
              : "登录成功",
      });
    } catch (error) {
      setNotice({ kind: "error", message: (error as Error).message });
    } finally {
      notifyParticipantChange();
      await refresh();
      setBusy(false);
    }
  }
  return (
    <section className="panel mb-6" aria-label="参与者账号">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {participant ? (
          <>
            <p className="min-w-0 break-words text-sm">
              当前账号：<strong>{participant.name}</strong>
            </p>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void act("logout")}
            >
              退出账号
            </button>
          </>
        ) : (
          <>
            <div
              role="status"
              className="flex min-w-0 items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mt-0.5 size-5 shrink-0 text-amber-600"
              >
                <path d="M12 3 2 21h20L12 3Z" />
                <path d="M12 9v5m0 3h.01" />
              </svg>
              <p className="min-w-0 break-words">
                <strong className="font-semibold">正在匿名使用。</strong>
                登录后可跨设备管理已认领的任务。
              </p>
            </div>
            <div className="flex flex-wrap gap-4">
              <button
                className="text-button"
                disabled={busy}
                onClick={() => changeMode("login")}
              >
                登录账号
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => changeMode("register")}
              >
                注册账号
              </button>
            </div>
          </>
        )}
      </div>
      {!participant && mode && (
        <form
          className="mt-5 max-w-xl space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void act(mode);
          }}
        >
          <h2>{mode === "register" ? "注册参与者账号" : "登录参与者账号"}</h2>
          <label className="block">
            邮箱
            <input
              className="mt-2"
              type="email"
              autoComplete="username"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </label>
          {mode === "register" && (
            <label className="block">
              姓名
              <input
                className="mt-2"
                autoComplete="name"
                required
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </label>
          )}
          <label className="block">
            密码
            <input
              className="mt-2"
              type="password"
              autoComplete={
                mode === "register" ? "new-password" : "current-password"
              }
              required
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </label>
          {mode === "register" && (
            <label className="block">
              确认密码
              <input
                className="mt-2"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={busy}
              />
            </label>
          )}
          <p className="hint">
            密码 8–128 位，无需特定字符组合。忘记密码请联系管理员。
          </p>
          <div className="flex gap-3">
            <button className="button" disabled={busy}>
              {busy ? "正在处理…" : mode === "register" ? "注册并登录" : "登录"}
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => changeMode(null)}
            >
              收起
            </button>
          </div>
        </form>
      )}
      {notice && (
        <ItemNotice itemId="participant" {...notice} onDismiss={dismiss} />
      )}
    </section>
  );
}
