import Link from "next/link";
export function Shell({
  admin = false,
  children,
}: {
  admin?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-5 sm:px-10">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:py-3">
        跳到主要内容
      </a>
      <header className="flex items-center justify-between gap-4 border-b border-emerald-950/10 py-6">
        <Link
          href="/"
          className="flex items-center gap-3 font-semibold tracking-tight"
        >
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-xl bg-emerald-900 text-lg text-white"
          >
            ✓
          </span>
          <span className="text-xl">ClaimList</span>
        </Link>
        <Link href={admin ? "/" : "/admin"} className="button secondary">
          {admin ? "返回清单" : "设置与管理"}
        </Link>
      </header>
      <main id="main-content" className="flex-1 py-9 sm:py-12">
        {children}
      </main>
      <footer className="flex flex-wrap justify-between gap-2 border-t border-emerald-950/10 py-6 text-xs text-slate-500">
        <span>ClaimList · 简单分工，一起完成</span>
        <span>团队内部协作</span>
      </footer>
    </div>
  );
}
export function Status({
  completed,
  claimed,
}: {
  completed: boolean;
  claimed: boolean;
}) {
  return (
    <span
      className={`status ${completed ? "bg-emerald-50 text-emerald-800" : claimed ? "bg-blue-50 text-blue-800" : "bg-slate-100 text-slate-600"}`}
    >
      {completed ? "已完成" : claimed ? "进行中" : "待认领"}
    </span>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <div
      role={error ? "alert" : "status"}
      className={`notice ${error ? "border-amber-200 bg-amber-50 text-amber-950" : "border-emerald-100 bg-emerald-50 text-emerald-950"}`}
    >
      {children}
    </div>
  );
}
