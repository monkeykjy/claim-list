import "server-only";
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function text(
  value: unknown,
  label: string,
  max: number,
  empty = false,
) {
  if (typeof value !== "string") throw new AppError(400, `${label}格式不正确`);
  const result = value.trim();
  if ((!empty && !result) || result.length > max)
    throw new AppError(
      400,
      `${label}${empty ? "" : "不能为空，且"}最多 ${max} 个字符`,
    );
  return result;
}
export function password(value: unknown) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128)
    throw new AppError(400, "密码须为 8–128 个字符");
  return value;
}
