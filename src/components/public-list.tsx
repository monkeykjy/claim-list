"use client";
import { useCallback, useState } from "react";
import { request, RequestError, useDraft } from "@/client/browser";
import { useRemote } from "@/client/use-list";
import { limits, type ListData } from "@/shared/model";
import { ParticipantPanel, type AccountMode } from "./participant-panel";
import { Shell, Notice, Status } from "./shell";
import { ItemNotice, type ItemNoticeData } from "./item-notice";
type Drafts = Record<string, { name: string; title: string }>;
const emptyDrafts: Drafts = {};
export function PublicList() {
  const { data, error, warning, updated, refresh } =
    useRemote<ListData>("/api/list");
  const [drafts, setDrafts] = useDraft("claims", emptyDrafts);
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const refreshAfterAccountAction = useCallback(() => {
    setMessage("");
    return refresh();
  }, [refresh]);
  const [busy, setBusy] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountMode, setAccountMode] = useState<AccountMode>(null);
  const [itemNotices, setItemNotices] = useState<
    Record<string, ItemNoticeData>
  >({});
  const dismissNotice = useCallback((itemId: string) => {
    setItemNotices((previous) => {
      const next = { ...previous };
      delete next[itemId];
      return next;
    });
  }, []);
  const clear = (id: string) =>
    setDrafts((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
  async function act(action: "claim" | "complete", id: string) {
    const item = data?.items.find((item) => item.id === id);
    if (!item || busy || accountBusy) return;
    const name = drafts[id]?.name || "";
    if (action === "claim" && !data?.participant && !name.trim()) {
      setMessageError(true);
      setMessage("请填写姓名后再认领");
      return;
    }
    if (
      !window.confirm(
        action === "claim"
          ? `确定以“${data?.participant?.name || name.trim()}”认领“${item.title}”吗？`
          : `确定将“${item.title}”标记为已完成吗？`,
      )
    )
      return;
    dismissNotice(id);
    setBusy(id);
    setMessage("");
    setMessageError(false);
    try {
      await request("/api/action", {
        action,
        id,
        name,
        expectedAccountId: data?.participant?.id || null,
      });
      if (action === "claim" && !data?.participant)
        setDrafts((previous) => {
          if (previous[id]?.name !== name) return previous;
          const next = { ...previous };
          delete next[id];
          return next;
        });
      setItemNotices((previous) => ({
        ...previous,
        [id]: {
          kind: "success",
          message:
            action === "claim"
              ? "认领成功，开始动手吧。"
              : "已标记完成，辛苦了。",
        },
      }));
    } catch (e) {
      if (
        action === "claim" &&
        e instanceof RequestError &&
        e.details?.code === "ALREADY_CLAIMED"
      ) {
        clear(id);
        setItemNotices((previous) => ({
          ...previous,
          [id]: { message: e.message, kind: "error" },
        }));
      } else {
        setMessageError(true);
        setMessage((e as Error).message);
      }
    } finally {
      await refresh();
      setBusy("");
    }
  }
  const orphaned = data
    ? Object.entries(drafts).filter(
        ([id, d]) => d.name && !data.items.some((i) => i.id === id),
      )
    : [];
  return (
    <Shell>
      {data && (
        <ParticipantPanel
          participant={data.participant}
          mode={accountMode}
          setMode={setAccountMode}
          refresh={refreshAfterAccountAction}
          busy={accountBusy || !!busy}
          setBusy={setAccountBusy}
        />
      )}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="eyebrow">把事情列出来，大家领着做</p>
          <h1>{data?.config.listName || "认领清单"}</h1>
          {data?.config.description && (
            <p className="mt-3 max-w-2xl whitespace-pre-wrap text-slate-600">
              {data.config.description}
            </p>
          )}
        </div>
        <div className="text-sm text-slate-500">
          <button className="text-button" onClick={() => void refresh()}>
            刷新列表
          </button>
          {updated && (
            <p className="mt-1 text-xs">
              最近更新{" "}
              {new Date(updated).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </p>
          )}
        </div>
      </div>
      {warning && <Notice error>{warning}</Notice>}
      {error && <Notice error>{error}</Notice>}
      {message && <Notice error={messageError}>{message}</Notice>}
      {!data ? (
        <div className="panel py-14 text-center" aria-busy={!error}>
          {error ? "暂时无法加载清单，请点击刷新列表重试。" : "正在加载清单…"}
        </div>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-4 text-sm text-slate-600">
            <span>共 {data.items.length} 项</span>
            <span>待认领 {data.items.filter((i) => !i.claimant).length}</span>
            <span>
              进行中{" "}
              {data.items.filter((i) => i.claimant && !i.completedAt).length}
            </span>
            <span>已完成 {data.items.filter((i) => i.completedAt).length}</span>
          </div>
          {!data.items.length ? (
            <div className="panel py-16 text-center">
              <h2>还没有条目</h2>
              <p className="mt-3 text-sm text-slate-500">
                暂无条目，管理员可通过右上角设置添加
              </p>
            </div>
          ) : (
            <section
              aria-label="认领清单"
              className="overflow-hidden rounded-2xl border border-emerald-950/10 bg-white"
            >
              <div className="hidden grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_170px] gap-6 border-b border-slate-100 bg-slate-50/70 px-7 py-4 text-xs font-medium text-slate-500 md:grid">
                <span>{data.config.titleLabel}</span>
                <span>{data.config.claimantLabel}</span>
                <span>{data.config.statusLabel}</span>
              </div>
              {data.items.map((item, index) => (
                <article
                  key={item.id}
                  aria-label={item.title}
                  className="grid gap-4 border-b border-slate-100 p-5 last:border-0 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_170px] md:items-start md:gap-6 md:p-7"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-1 text-xs tabular-nums text-slate-400">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h2 className="min-w-0 text-base leading-7 break-words">
                      {item.title}
                    </h2>
                  </div>
                  <div className="min-w-0">
                    {drafts[item.id]?.name &&
                      drafts[item.id].title !== item.title && (
                        <p
                          role="status"
                          className="mb-3 text-xs leading-5 text-amber-800"
                        >
                          标题已更新，请核对最新内容；姓名草稿已保留。
                        </p>
                      )}
                    {!item.claimant ? (
                      <form
                        className="flex gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void act("claim", item.id);
                        }}
                      >
                        {!data.participant && (
                          <input
                            aria-label={`认领 ${item.title} 的姓名`}
                            placeholder="填写你的姓名"
                            maxLength={limits.name}
                            required
                            value={drafts[item.id]?.name || ""}
                            onChange={(e) =>
                              setDrafts((p) => ({
                                ...p,
                                [item.id]: {
                                  name: e.target.value,
                                  title: item.title,
                                },
                              }))
                            }
                          />
                        )}
                        <button
                          className="button shrink-0"
                          disabled={!!busy || accountBusy}
                        >
                          {busy === item.id ? "提交中…" : "认领"}
                        </button>
                      </form>
                    ) : (
                      <>
                        <p className="py-1 text-sm break-words">
                          {item.claimant}
                        </p>
                        {drafts[item.id]?.name && (
                          <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-950">
                            <p>条目已被认领，未提交的姓名草稿已保留：</p>
                            <input
                              className="mt-2"
                              aria-label="未提交姓名草稿"
                              readOnly
                              value={drafts[item.id].name}
                            />
                            <button
                              className="text-button mt-2"
                              onClick={() => clear(item.id)}
                            >
                              清除草稿
                            </button>
                          </div>
                        )}
                      </>
                    )}
                    {itemNotices[item.id] && (
                      <ItemNotice
                        itemId={item.id}
                        {...itemNotices[item.id]}
                        onDismiss={dismissNotice}
                      />
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 md:flex-col md:items-start">
                    <Status
                      completed={!!item.completedAt}
                      claimed={!!item.claimant}
                    />
                    {item.accountBound &&
                      !item.completedAt &&
                      !data.participant && (
                        <button
                          className="text-button"
                          onClick={() => {
                            setAccountMode("login");
                            document
                              .querySelector('[aria-label="参与者账号"]')
                              ?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              });
                          }}
                        >
                          登录后完成
                        </button>
                      )}
                    {item.isMine && (
                      <span className="text-xs text-emerald-700">我的认领</span>
                    )}
                    {item.canComplete && (
                      <button
                        className="button secondary"
                        disabled={!!busy || accountBusy}
                        onClick={() => void act("complete", item.id)}
                      >
                        {busy === item.id ? "提交中…" : "标记完成"}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </section>
          )}
          {!!orphaned.length && (
            <section className="panel mt-6">
              <h2>已删除条目的未提交草稿</h2>
              <p className="hint mt-2">条目已不存在，以下内容仍可复制。</p>
              {orphaned.map(([id, d]) => (
                <div key={id} className="mt-4">
                  <label>
                    {d.title}
                    <input className="mt-2" readOnly value={d.name} />
                  </label>
                  <button
                    className="text-button mt-2"
                    onClick={() => clear(id)}
                  >
                    清除草稿
                  </button>
                </div>
              ))}
            </section>
          )}
          <p className="mt-5 text-xs leading-6 text-slate-500">
            可匿名认领，也可登录后跨设备完成。需要换人或撤销时，请联系管理员。
          </p>
        </>
      )}
    </Shell>
  );
}
