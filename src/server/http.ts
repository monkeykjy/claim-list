import "server-only";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isIP } from "node:net";
import { AppError } from "./errors";
import { SESSION_MS } from "./store";
import { PARTICIPANT_SESSION_MS } from "./participants";
export const PARTICIPANT_COOKIE = "claimlist-participant";
export const COOKIE = "claimlist-admin";
export const tokenOf = (req: NextRequest) =>
  req.cookies.get(COOKIE)?.value || "";
export function identityOf(req: NextRequest) {
  const ip = req.headers.get("x-claimlist-ip") || "";
  if (
    !process.env.CLAIMLIST_TRANSPORT_SECRET ||
    req.headers.get("x-claimlist-transport") !==
      process.env.CLAIMLIST_TRANSPORT_SECRET ||
    !isIP(ip)
  )
    throw new AppError(
      503,
      "服务入口配置错误，请使用 pnpm dev 或 pnpm start 启动",
    );
  const uuid = req.headers.get("x-browser-id") || "";
  if (
    uuid &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      uuid,
    )
  )
    throw new AppError(400, "浏览器标识格式不正确");
  return {
    ip,
    uuid,
    participantToken: req.cookies.get(PARTICIPANT_COOKIE)?.value || "",
  };
}
export function json(data: unknown, token?: string, participant = false) {
  const response = NextResponse.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
  if (token !== undefined)
    response.cookies.set(participant ? PARTICIPANT_COOKIE : COOKIE, token, {
      httpOnly: true,
      secure: process.env.APP_ORIGIN?.startsWith("https://") || false,
      sameSite: "strict",
      path: "/",
      maxAge: token
        ? (participant ? PARTICIPANT_SESSION_MS : SESSION_MS) / 1000
        : 0,
    });
  return response;
}
export async function handle(action: () => Response | Promise<Response>) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof AppError)
      return NextResponse.json(
        { error: error.message, details: error.details },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    console.error(
      "Request failed:",
      error instanceof Error ? error.message : "unknown",
    );
    return NextResponse.json(
      { error: "服务暂时不可用，请稍后重试" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export async function bodyOf(req: NextRequest) {
  const expectedOrigin = req.headers.get("x-claimlist-origin");
  if (!expectedOrigin || req.headers.get("origin") !== expectedOrigin)
    throw new AppError(403, "请求来源不匹配，请从配置的站点地址打开");
  if (!req.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError(415, "仅接受 JSON 请求");
  const reader = req.body?.getReader();
  if (!reader) throw new AppError(400, "请求内容为空");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 200000) {
      await reader.cancel();
      throw new AppError(413, "请求内容过大");
    }
    chunks.push(value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new AppError(400, "请求内容格式不正确");
  }
}
