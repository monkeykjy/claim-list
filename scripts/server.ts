process.umask(0o077);
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import next from "next";
import { clientIp, normalizeIp, directOrigin } from "./network";
import { networkInterfaces } from "node:os";
import { parseArgs } from "node:util";
import { acquireLock, runtimePath } from "./runtime-lock";

const { values } = parseArgs({
  options: {
    production: { type: "boolean", default: false },
    hostname: { type: "string" },
    port: { type: "string" },
  },
});
const dev = !values.production;
const port = Number(values.port || process.env.PORT || 1234);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("端口须为 1–65535 的整数");
const hostname = values.hostname || process.env.LISTEN_HOST || "0.0.0.0";
const trusted = (process.env.TRUSTED_PROXY_IPS || "")
  .split(",")
  .filter(Boolean)
  .map(normalizeIp);
const configuredOrigin = process.env.APP_ORIGIN || "";
if (configuredOrigin) {
  const parsed = new URL(configuredOrigin);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.origin !== configuredOrigin
  )
    throw new Error("APP_ORIGIN 必须是无尾斜杠的 HTTP(S) 来源");
}
const localHosts = [
  "localhost",
  "127.0.0.1",
  "::1",
  ...Object.values(networkInterfaces())
    .flatMap((entries) => entries || [])
    .map((entry) => normalizeIp(entry.address)),
];
const secret = randomBytes(32).toString("hex");
process.env.CLAIMLIST_TRANSPORT_SECRET = secret;
const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();
async function main() {
  const release = acquireLock(runtimePath());
  process.once("exit", release);
  await app.prepare();
  const server = createServer((req, res) => {
    try {
      const origin = new URL(
        configuredOrigin || directOrigin(req.headers.host, port, localHosts),
      );
      const ip = clientIp(
        req.socket.remoteAddress || "",
        req.headers["x-real-ip"],
        trusted,
      );
      // These internal headers are always replaced, even when supplied by a visitor.
      req.headers["x-claimlist-ip"] = ip;
      req.headers["x-claimlist-origin"] = origin.origin;
      req.headers["x-claimlist-transport"] = secret;
      delete req.headers["x-forwarded-for"];
      delete req.headers["x-real-ip"];
      req.headers["x-forwarded-proto"] = origin.protocol.slice(0, -1);
      req.headers["x-forwarded-host"] = origin.host;
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Referrer-Policy", "same-origin");
      void handler(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end("请求失败");
      });
    } catch {
      res.writeHead(400);
      res.end("访问地址或来源 IP 无效，请检查站点和代理配置");
    }
  });
  server.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });
  server.requestTimeout = 30000;
  server.listen(port, hostname, () =>
    console.log(
      `ClaimList: listening on ${hostname}:${port} (${dev ? "development" : "production"}); visit ${configuredOrigin || `http://127.0.0.1:${port}`}`,
    ),
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      server.close(() => {
        void app.close().finally(() => process.exit(0));
      });
      setTimeout(() => process.exit(0), 5000).unref();
    });
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
