"use client";
import { useCallback, useRef, useState } from "react";
import { notifyParticipantChange, request, useDraft } from "@/client/browser";
import type { Participant } from "@/shared/model";
import { ItemNotice, type ItemNoticeData } from "./item-notice";
type Account = Participant & { email: string };
export function ParticipantAdmin({
  refresh,
}: {
  refresh: () => Promise<void>;
}) {
  const [query, setQuery] = useDraft("participant-query", "");
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [selected, setSelected] = useState<Account | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [notice, setNotice] = useState<ItemNoticeData | null>(null);
  const dismiss = useCallback(() => setNotice(null), []);
  async function act(reset: boolean) {
    if (pending.current) return;
    if (
      reset &&
      (!selected ||
        !window.confirm(
          `重置 ${selected.name}（${selected.email}）的密码？该账号所有设备将退出登录，任务归属保留。`,
        ))
    )
      return;
    pending.current = true;
    setBusy(true);
    setNotice(null);
    try {
      if (reset) {
        await request("/api/action", {
          action: "participant-reset",
          id: selected!.id,
          password,
          confirm,
        });
        setPassword("");
        setConfirm("");
        setSelected(null);
        notifyParticipantChange();
        setNotice({
          kind: "success",
          message: "参与者密码已重置，原登录会话已失效。请私下告知对方新密码。",
        });
      } else {
        const result = await request<{ accounts: Account[] }>("/api/action", {
          action: "participant-search",
          query,
        });
        setAccounts(result.accounts);
        setSelected(null);
        setPassword("");
        setConfirm("");
      }
    } catch (error) {
      setNotice({ kind: "error", message: (error as Error).message });
    } finally {
      await refresh();
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="panel mt-6" aria-label="参与者密码管理">
      <h2>参与者密码管理</h2>
      <p className="hint mt-2">
        按邮箱或姓名查找账号。重置只影响选中账号，不改变任务归属。
      </p>
      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void act(false);
        }}
      >
        <label className="min-w-0 flex-1">
          查找参与者
          <input
            className="mt-2"
            value={query}
            maxLength={254}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button className="button secondary" disabled={busy}>
          查找账号
        </button>
      </form>
      {accounts && (
        <div className="mt-4 space-y-2">
          {!accounts.length && <p className="hint">没有找到账号</p>}
          {accounts.map((account) => (
            <button
              key={account.id}
              className={`block w-full rounded-lg border p-3 text-left text-sm break-words ${selected?.id === account.id ? "border-emerald-700 bg-emerald-50" : "border-slate-200"}`}
              disabled={busy}
              onClick={() => {
                setSelected(account);
                setPassword("");
                setConfirm("");
              }}
            >
              <strong>{account.name}</strong> · {account.email}
            </button>
          ))}
          {accounts.length === 50 && (
            <p className="hint">
              仅显示前 50 个结果，请输入更完整的邮箱或姓名。
            </p>
          )}
        </div>
      )}
      {selected && (
        <form
          className="mt-5 max-w-xl space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void act(true);
          }}
        >
          <p className="text-sm break-words">
            重置目标：{selected.name}（{selected.email}）
          </p>
          <label className="block">
            参与者新密码
            <input
              className="mt-2"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="block">
            确认参与者新密码
            <input
              className="mt-2"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={busy}
            />
          </label>
          <button className="button" disabled={busy}>
            重置参与者密码
          </button>
        </form>
      )}
      {notice && (
        <ItemNotice
          itemId="participant-reset"
          {...notice}
          onDismiss={dismiss}
        />
      )}
    </section>
  );
}
