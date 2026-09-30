import "server-only";
import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { password } from "./errors";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function hashPassword(value: unknown) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password(value), salt, 64).toString("hex")}`;
}
export function matches(value: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(value, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
