"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";
const memory = new Map<string, string>();
let ephemeralId = "";
let warning = "";
export function browserId() {
  if (ephemeralId) return ephemeralId;
  try {
    const previous = localStorage.getItem("claimlist:uuid");
    if (
      previous &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        previous,
      )
    )
      return (ephemeralId = previous);
  } catch {
    warning =
      "浏览器存储不可用，无法长期保留身份和草稿；下次访问可能无法完成原条目，请联系管理员。";
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  ephemeralId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  try {
    localStorage.setItem("claimlist:uuid", ephemeralId);
  } catch {
    warning =
      "浏览器存储不可用，无法长期保留身份和草稿；下次访问可能无法完成原条目，请联系管理员。";
  }
  return ephemeralId;
}
export const storageWarning = () => warning;
function subscribe(listener: () => void) {
  window.addEventListener("claimlist-draft", listener);
  return () => window.removeEventListener("claimlist-draft", listener);
}
function read(key: string) {
  if (memory.has(key)) return memory.get(key)!;
  try {
    return sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
}
export function useDraft<T>(name: string, initial: T) {
  const key = `claimlist:draft:${name}`;
  const raw = useSyncExternalStore(
    subscribe,
    useCallback(() => read(key), [key]),
    () => "",
  );
  const value = useMemo(() => {
    try {
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  }, [raw, initial]);
  const set = useCallback(
    (next: T | ((previous: T) => T)) => {
      let previous = initial;
      try {
        const saved = read(key);
        if (saved) previous = JSON.parse(saved);
      } catch {
        /* Use the provided empty draft. */
      }
      const encoded = JSON.stringify(
        typeof next === "function" ? (next as (v: T) => T)(previous) : next,
      );
      memory.set(key, encoded);
      try {
        sessionStorage.setItem(key, encoded);
      } catch {
        warning = "草稿暂存不可用，离开或刷新页面前请复制未提交内容。";
      }
      window.dispatchEvent(new Event("claimlist-draft"));
    },
    [key, initial],
  );
  return [value, set] as const;
}
export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: { code?: string },
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body ? "POST" : "GET",
      cache: "no-store",
      headers: {
        "x-browser-id": browserId(),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new RequestError(
      body
        ? "暂时无法确认结果，输入已保留。请核对刷新后的状态再重试。"
        : "更新失败，仍显示上次成功的内容。请稍后重试。",
      0,
    );
  }
  let value;
  try {
    value = await response.json();
  } catch {
    throw new RequestError(
      body
        ? "暂时无法确认结果，请核对最新状态。"
        : "无法读取列表，请稍后重试。",
      0,
    );
  }
  if (!response.ok) {
    const details = Array.isArray(value.details)
      ? value.details
          .map(
            (d: { title: string; lines: number[] }) =>
              `“${d.title}”（第 ${d.lines.join("、")} 行）`,
          )
          .join("；")
      : "";
    throw new RequestError(
      `${value.error || "请求失败"}${details ? `：${details}` : ""}`,
      response.status,
      value.details,
    );
  }
  return value as T;
}

export function notifyParticipantChange() {
  try {
    localStorage.setItem(
      "claimlist:participant-change",
      `${Date.now()}:${Math.random()}`,
    );
  } catch {
    /* Focus/polling still synchronizes sessions when storage is unavailable. */
  }
  window.dispatchEvent(new Event("claimlist-participant-change"));
}
