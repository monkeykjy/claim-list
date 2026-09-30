"use client";
import { useEffect } from "react";

export type ItemNoticeData = { message: string; kind: "success" | "error" };

export function ItemNotice({
  itemId,
  message,
  kind,
  onDismiss,
}: ItemNoticeData & {
  itemId: string;
  onDismiss: (itemId: string) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(itemId), 5000);
    return () => clearTimeout(timer);
  }, [itemId, message, kind, onDismiss]);

  const success = kind === "success";
  return (
    <div
      role="status"
      aria-live="polite"
      className={`mt-3 flex items-start gap-2 rounded-lg border p-3 text-sm font-medium leading-6 break-words ${success ? "border-green-300 bg-green-100 text-green-900" : "border-red-300 bg-red-100 text-red-900"}`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`mt-0.5 size-5 shrink-0 ${success ? "text-green-700" : "text-red-700"}`}
      >
        <path d={success ? "m5 12 4 4L19 6" : "m6 6 12 12M18 6 6 18"} />
      </svg>
      <span className="min-w-0">{message}</span>
    </div>
  );
}
