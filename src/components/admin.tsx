"use client";
import { useState } from "react";
import { request, useDraft } from "@/client/browser";
import { useRemote } from "@/client/use-list";
import { limits, type AdminData, type Config, type Item } from "@/shared/model";
import { ParticipantAdmin } from "./participant-admin";
import { Shell, Notice, Status } from "./shell";
type Editor = {
  id: string;
  title: string;
  operation: "title" | "name";
  value: string;
  revision: number;
} | null;
type ConfigDraft = { values: Config; base: string } | null;
const configFields: { key: keyof Config; label: string; max: number }[] = [
  { key: "listName", label: "清单名称", max: limits.listName },
  { key: "description", label: "简短说明", max: limits.description },
  { key: "titleLabel", label: "标题列名", max: limits.label },
  { key: "claimantLabel", label: "认领人列名", max: limits.label },
  { key: "statusLabel", label: "状态列名", max: limits.label },
];
export function Admin() {
  const { data, error, warning, refresh } = useRemote<AdminData>("/api/admin");
  const [batch, setBatch] = useDraft("batch", "");
  const [editor, setEditor] = useDraft<Editor>("editor", null);
  const [configDraft, setConfigDraft] = useDraft<ConfigDraft>("config", null);
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const [busy, setBusy] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  async function act(
    key: string,
    body: Record<string, unknown>,
    success = "已保存",
  ) {
    setBusy(key);
    setMessage("");
    setMessageError(false);
    let ok = false;
    try {
      const result = await request<{ count?: number }>("/api/action", body);
      setMessage(
        result.count !== undefined ? `已新增 ${result.count} 个条目` : success,
      );
      ok = true;
    } catch (e) {
      setMessageError(true);
      setMessage((e as Error).message);
    } finally {
      await refresh();
      setBusy("");
    }
    return ok;
  }
  async function authenticate() {
    const action = data?.initialized ? "login" : "initialize";
    if (
      await act(
        "auth",
        { action, password, confirm, token },
        action === "login" ? "登录成功" : "初始化成功",
      )
    ) {
      setPassword("");
      setConfirm("");
      setToken("");
    }
  }
  function begin(item: Item, operation: "title" | "name") {
    if (editor && !window.confirm("切换编辑会替换当前编辑草稿，是否继续？"))
      return;
    setEditor({
      id: item.id,
      title: item.title,
      operation,
      value: operation === "title" ? item.title : item.claimant || "",
      revision: item.revision,
    });
  }
  async function edit(item: Item, operation: string) {
    if (
      operation === "delete" &&
      !window.confirm(
        `删除“${item.title}”？认领和完成信息也会删除，重新添加同名条目不会恢复这些信息。`,
      )
    )
      return;
    if (
      operation === "release" &&
      !window.confirm(
        `释放“${item.title}”？这会清空认领人、归属凭据和完成信息。`,
      )
    )
      return;
    await act(
      item.id,
      { action: "edit", id: item.id, revision: item.revision, operation },
      operation === "delete" ? "条目已删除" : "条目状态已更新",
    );
  }
  const list = data?.list;
  const latest = list?.items.find((i) => i.id === editor?.id);
  const changed = !!editor && latest?.revision !== editor.revision;
  const config = configDraft?.values || list?.config;
  const configChanged =
    !!configDraft && JSON.stringify(list?.config) !== configDraft.base;
  return (
    <Shell admin>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">清单设置</p>
          <h1>
            {data?.authenticated
              ? "管理清单"
              : data?.initialized
                ? "管理员登录"
                : "首次设置"}
          </h1>
        </div>
        {data?.authenticated && (
          <div className="flex gap-3">
            <button className="button secondary" onClick={() => void refresh()}>
              刷新
            </button>
            <button
              className="button secondary"
              disabled={!!busy}
              onClick={() =>
                void act(
                  "logout",
                  { action: "logout" },
                  "已退出，普通文本草稿已保留",
                )
              }
            >
              退出管理
            </button>
          </div>
        )}
      </div>
      {warning && <Notice error>{warning}</Notice>}
      {error && <Notice error>{error}</Notice>}
      {message && <Notice error={messageError}>{message}</Notice>}
      {!data ? (
        <div className="panel">
          {error ? "无法加载设置状态。" : "正在检查管理状态…"}
          <button className="text-button ml-3" onClick={() => void refresh()}>
            重试
          </button>
        </div>
      ) : !data.authenticated ? (
        <section className="panel max-w-xl">
          <h2>{data.initialized ? "输入管理密码" : "设置管理密码"}</h2>
          <p className="hint mt-2">
            {data.initialized
              ? "登录后可维护条目和清单设置。会话有效期为 24 小时。"
              : "请向服务器维护者获取一次性初始化口令。设置成功后，该口令立即失效。"}
          </p>
          <form
            className="mt-6 space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void authenticate();
            }}
          >
            {!data.initialized && (
              <label>
                初始化口令
                <input
                  className="mt-2"
                  type="password"
                  autoComplete="off"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </label>
            )}
            <label>
              {data.initialized ? "管理密码" : "新管理密码"}
              <input
                className="mt-2"
                type="password"
                autoComplete={
                  data.initialized ? "current-password" : "new-password"
                }
                minLength={8}
                maxLength={128}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {!data.initialized && (
              <label>
                确认密码
                <input
                  className="mt-2"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
            )}
            <p className="hint">
              密码须为 8–128 个字符。密码和初始化口令不会保存为草稿。
            </p>
            <button className="button" disabled={!!busy}>
              {busy === "auth"
                ? "正在验证…"
                : data.initialized
                  ? "登录"
                  : "设置并进入管理"}
            </button>
          </form>
          {data.initialized && (
            <p className="hint mt-6">
              忘记密码？请联系服务器维护者运行 <code>pnpm reset:passwd</code>。
            </p>
          )}
        </section>
      ) : (
        list && (
          <div className="space-y-7">
            <section className="panel">
              <h2>批量新增</h2>
              <p className="hint mt-2">
                一行一个条目，空行跳过，重复时整批不添加。每批最多{" "}
                {limits.batch} 条，每个标题最多 {limits.title} 个字符。
              </p>
              <form
                className="mt-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = batch;
                  void act("batch", { action: "batch", text: value }).then(
                    (ok) => {
                      if (ok) setBatch((p) => (p === value ? "" : p));
                    },
                  );
                }}
              >
                <label className="sr-only" htmlFor="batch">
                  批量条目
                </label>
                <textarea
                  id="batch"
                  className="min-h-40"
                  placeholder={"例如：\n实现首页\n配置部署\n补充使用说明"}
                  maxLength={50000}
                  value={batch}
                  onChange={(e) => setBatch(e.target.value)}
                  required
                />
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="hint">
                    失败时会保留全文，并指出冲突标题及行号。
                  </p>
                  <button className="button" disabled={!!busy}>
                    {busy === "batch" ? "添加中…" : "添加条目"}
                  </button>
                </div>
              </form>
            </section>
            {editor && (
              <section
                className="panel border-emerald-700"
                aria-label="编辑条目"
              >
                <h2>
                  {editor.operation === "title" ? "修改标题" : "更正姓名"} ·{" "}
                  {editor.title}
                </h2>
                {changed && (
                  <Notice error>
                    {latest
                      ? "条目已变化，请核对列表中的最新内容。草稿已保留。"
                      : "该条目已不存在，草稿已保留供复制。"}
                  </Notice>
                )}
                <form
                  className="mt-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const value = editor;
                    void act("editor", { action: "edit", ...editor }).then(
                      (ok) => {
                        if (ok)
                          setEditor((p) =>
                            p?.value === value.value && p.id === value.id
                              ? null
                              : p,
                          );
                      },
                    );
                  }}
                >
                  <label>
                    {editor.operation === "title" ? "新标题" : "显示姓名"}
                    <input
                      className="mt-2"
                      required
                      maxLength={
                        editor.operation === "title"
                          ? limits.title
                          : limits.name
                      }
                      value={editor.value}
                      onChange={(e) =>
                        setEditor({ ...editor, value: e.target.value })
                      }
                    />
                  </label>
                  {editor.operation === "name" && (
                    <p className="hint mt-3">
                      仅更正显示姓名，不转移实际负责人。换人请先释放认领，再由新负责人认领。
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button className="button" disabled={!!busy || changed}>
                      保存修改
                    </button>
                    {changed && latest && (
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() =>
                          setEditor({ ...editor, revision: latest.revision })
                        }
                      >
                        已核对，使用最新版本
                      </button>
                    )}
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => {
                        if (window.confirm("丢弃这份编辑草稿？"))
                          setEditor(null);
                      }}
                    >
                      丢弃草稿
                    </button>
                  </div>
                </form>
              </section>
            )}
            <section className="panel">
              <div className="flex items-center justify-between">
                <h2>现有条目</h2>
                <span className="hint">共 {list.items.length} 项</span>
              </div>
              <p className="hint mt-2">
                更正姓名不会转移实际负责人；换人请先释放，再由新负责人认领。
              </p>
              {!list.items.length ? (
                <p className="py-10 text-center text-slate-500">
                  还没有条目，从上方批量添加开始。
                </p>
              ) : (
                <div className="mt-5 divide-y divide-slate-100">
                  {list.items.map((item) => (
                    <article
                      key={item.id}
                      aria-label={item.title}
                      className="flex flex-wrap items-center justify-between gap-4 py-5"
                    >
                      <div className="min-w-0 flex-1 basis-64">
                        <h3 className="font-medium break-words">
                          {item.title}
                        </h3>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <Status
                            completed={!!item.completedAt}
                            claimed={!!item.claimant}
                          />
                          {item.claimant && (
                            <span className="text-sm break-words text-slate-600">
                              {item.claimant}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="button secondary"
                          disabled={!!busy}
                          onClick={() => begin(item, "title")}
                        >
                          修改标题
                        </button>
                        {item.claimant && (
                          <>
                            <button
                              className="button secondary"
                              disabled={!!busy}
                              onClick={() => begin(item, "name")}
                            >
                              更正姓名
                            </button>
                            <button
                              className="button secondary"
                              disabled={!!busy}
                              onClick={() =>
                                void edit(
                                  item,
                                  item.completedAt ? "reopen" : "finish",
                                )
                              }
                            >
                              {item.completedAt ? "重新打开" : "代为完成"}
                            </button>
                            <button
                              className="button secondary"
                              disabled={!!busy}
                              onClick={() => void edit(item, "release")}
                            >
                              释放认领
                            </button>
                          </>
                        )}
                        <button
                          className="button danger"
                          disabled={!!busy}
                          onClick={() => void edit(item, "delete")}
                        >
                          删除
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
            {config && (
              <section className="panel">
                <h2>清单文案</h2>
                <p className="hint mt-2">
                  只调整显示文案，三个状态值和操作规则保持不变。
                </p>
                {configChanged && (
                  <Notice error>
                    清单文案已被更新，请核对最新配置后再保存。
                    <button
                      className="text-button ml-2"
                      onClick={() =>
                        setConfigDraft({
                          values: config,
                          base: JSON.stringify(list.config),
                        })
                      }
                    >
                      已核对，保留我的草稿
                    </button>
                  </Notice>
                )}
                <form
                  className="mt-5 grid gap-5 sm:grid-cols-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const current = configDraft;
                    void act("config", {
                      action: "config",
                      ...config,
                      base: configDraft?.base || JSON.stringify(list.config),
                    }).then((ok) => {
                      if (ok)
                        setConfigDraft((p) =>
                          JSON.stringify(p) === JSON.stringify(current)
                            ? null
                            : p,
                        );
                    });
                  }}
                >
                  {configFields.map((field) => (
                    <label
                      key={field.key}
                      className={
                        field.key === "description" ? "sm:col-span-2" : ""
                      }
                    >
                      {field.label}
                      <input
                        className="mt-2"
                        maxLength={field.max}
                        required={field.key !== "description"}
                        value={config[field.key]}
                        onChange={(e) =>
                          setConfigDraft({
                            values: { ...config, [field.key]: e.target.value },
                            base:
                              configDraft?.base || JSON.stringify(list.config),
                          })
                        }
                      />
                    </label>
                  ))}
                  <div className="sm:col-span-2">
                    <button
                      className="button"
                      disabled={!!busy || configChanged}
                    >
                      保存文案
                    </button>
                  </div>
                </form>
              </section>
            )}
            <section className="panel">
              <h2>修改管理密码</h2>
              <p className="hint mt-2">
                修改后包括当前会话在内的所有管理会话都会失效，需要重新登录。
              </p>
              <form
                className="mt-5 grid gap-5 sm:grid-cols-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(
                    "password",
                    { action: "password", oldPassword, password, confirm },
                    "密码已修改，请使用新密码登录",
                  ).then((ok) => {
                    if (ok) {
                      setOldPassword("");
                      setPassword("");
                      setConfirm("");
                    }
                  });
                }}
              >
                <label>
                  当前密码
                  <input
                    className="mt-2"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                  />
                </label>
                <label>
                  新密码
                  <input
                    className="mt-2"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <label>
                  确认新密码
                  <input
                    className="mt-2"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </label>
                <div className="sm:col-span-3">
                  <button className="button secondary" disabled={!!busy}>
                    修改密码并退出
                  </button>
                </div>
              </form>
            </section>
          </div>
        )
      )}
      {data?.authenticated && <ParticipantAdmin refresh={refresh} />}
    </Shell>
  );
}
