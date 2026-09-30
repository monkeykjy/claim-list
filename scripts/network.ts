import { isIP } from "node:net";
export function normalizeIp(value: string) {
  const input = value.trim().replace(/^::ffff:/, "");
  if (!isIP(input)) throw new Error("无效的来源 IP");
  return input.includes(":")
    ? new URL(`http://[${input}]/`).hostname.slice(1, -1)
    : input;
}
export function clientIp(
  peer: string,
  forwarded: string | string[] | undefined,
  trusted: string[],
) {
  const ip = normalizeIp(peer);
  if (!trusted.includes(ip)) return ip;
  if (typeof forwarded !== "string")
    throw new Error("可信代理必须设置 X-Real-IP");
  return normalizeIp(forwarded);
}

// Limit automatic origins to this machine, rather than trusting arbitrary Host headers.
export function directOrigin(
  host: string | undefined,
  port: number,
  localHosts: string[],
) {
  if (!host) throw new Error("缺少访问地址");
  const url = new URL(`http://${host}`);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const normalized = isIP(hostname) ? normalizeIp(hostname) : hostname;
  if (
    url.host !== host ||
    Number(url.port || 80) !== port ||
    !localHosts.includes(normalized)
  )
    throw new Error("请通过本机实际 IP 访问，或配置 APP_ORIGIN");
  return url.origin;
}
