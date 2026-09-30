"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { request, storageWarning } from "./browser";
export function useRemote<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [updated, setUpdated] = useState<number | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const result = await request<T>(url);
      if (current === generation.current) {
        setData(result);
        setError("");
        setUpdated(Date.now());
      }
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
    }
    setWarning(storageWarning());
  }, [url]);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(visible, 30000);
    const storage = (event: StorageEvent) => {
      if (event.key === "claimlist:participant-change") void refresh();
    };
    window.addEventListener("storage", storage);
    window.addEventListener("claimlist-participant-change", visible);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      invalidate();
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("storage", storage);
      window.removeEventListener("claimlist-participant-change", visible);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh, invalidate]);
  return { data, error, warning, updated, refresh };
}
