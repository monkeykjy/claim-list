import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
} from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const pass = "browser-test-password";
const origin = "http://127.0.0.1:3100";
const uuid = "a0000000-0000-4000-8000-000000000001";
async function confirmAction(button: Locator, accept = true) {
  const dialogHandled = button
    .page()
    .waitForEvent("dialog")
    .then(async (dialog) => {
      const message = dialog.message();
      if (accept) await dialog.accept();
      else await dialog.dismiss();
      expect(dialog.type()).toBe("confirm");
      return message;
    });
  await button.click();
  return dialogHandled;
}
async function action(api: APIRequestContext, data: Record<string, unknown>) {
  return api.post("/api/action", {
    data,
    headers: { origin, "x-browser-id": uuid },
  });
}

test("完整协作流程、刷新和认领冲突提示、管理员纠错、改密及响应式布局", async ({
  page,
  browser,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByText("暂无条目，管理员可通过右上角设置添加"),
  ).toBeVisible();
  await page.getByRole("link", { name: "设置与管理" }).click();
  await expect(page.getByRole("heading", { name: "首次设置" })).toBeVisible();
  await page.getByLabel("初始化口令").fill("invalid");
  await page.getByLabel("新管理密码", { exact: true }).fill(pass);
  await page.getByLabel("确认密码", { exact: true }).fill(pass);
  await page.getByRole("button", { name: "设置并进入管理" }).click();
  await expect(
    page.getByText("初始化口令不正确或未生成，请联系服务器维护者"),
  ).toBeVisible();
  await page
    .getByLabel("初始化口令")
    .fill(
      readFileSync(join(process.env.CLAIMLIST_E2E_DIR!, "init-token"), "utf8"),
    );
  await page.getByRole("button", { name: "设置并进入管理" }).click();
  await expect(
    page.getByRole("heading", { name: "管理清单", exact: true }),
  ).toBeVisible();
  const batch = page.getByLabel("批量条目");
  await batch.fill("实现首页\n实现首页");
  await page.getByRole("button", { name: "添加条目", exact: true }).click();
  await expect(page.getByText(/存在重复标题/)).toBeVisible();
  await expect(batch).toHaveValue("实现首页\n实现首页");
  await page.reload();
  await expect(batch).toHaveValue("实现首页\n实现首页");
  await batch.fill("实现首页\n配置部署\n补充使用说明");
  await page.getByRole("button", { name: "添加条目", exact: true }).click();
  await expect(page.getByText("已新增 3 个条目")).toBeVisible();
  await expect(batch).toHaveValue("");
  const unauthorized = await action(request, {
    action: "batch",
    text: "非法新增",
  });
  expect(unauthorized.status()).toBe(401);
  const foreign = await request.post("/api/action", {
    headers: { origin: "https://other.example" },
    data: { action: "claim", id: "fake", name: "fake" },
  });
  expect(foreign.status()).toBe(403);
  const participant = await browser.newContext();
  const publicPage = await participant.newPage();
  await publicPage.goto(origin);
  const claim = publicPage.getByRole("article", {
    name: "实现首页",
    exact: true,
  });
  await claim.getByRole("textbox").fill("林晓");
  await publicPage.reload();
  await expect(claim.getByRole("textbox")).toHaveValue("林晓");
  let mutations = 0;
  publicPage.on("request", (req) => {
    if (req.method() === "POST" && req.url().endsWith("/api/action"))
      mutations++;
  });
  expect(
    await confirmAction(
      claim.getByRole("button", { name: "认领", exact: true }),
      false,
    ),
  ).toBe("确定以“林晓”认领“实现首页”吗？");
  await expect(claim.getByRole("textbox")).toHaveValue("林晓");
  await expect(claim.getByText("待认领", { exact: true })).toBeVisible();
  expect(mutations).toBe(0);
  await confirmAction(claim.getByRole("button", { name: "认领", exact: true }));
  await expect(claim.getByText("进行中", { exact: true })).toBeVisible();
  await expect(
    claim.getByRole("status").filter({ hasText: "认领成功，开始动手吧。" }),
  ).toBeVisible();
  mkdirSync("docs/screenshots", { recursive: true });
  await publicPage.screenshot({
    path: "docs/screenshots/claim-success-tip.png",
    fullPage: true,
  });
  const publicData = await (
    await request.get("/api/list", {
      headers: {
        "x-browser-id": uuid,
        "x-real-ip": "1.2.3.4",
        "x-forwarded-for": "1.2.3.4",
      },
    })
  ).json();
  expect(publicData.items[0].canComplete).toBe(true);
  for (const key of ["claim_ip", "claim_uuid", "password_hash", "token_hash"])
    expect(JSON.stringify(publicData)).not.toContain(key);
  const conflict = publicPage.getByRole("article", {
    name: "配置部署",
    exact: true,
  });
  await conflict.getByRole("textbox").fill("我的未提交姓名");
  const id = publicData.items.find(
    (i: { title: string }) => i.title === "配置部署",
  ).id;
  expect(
    (await action(request, { action: "claim", id, name: "陈墨" })).ok(),
  ).toBe(true);
  await confirmAction(
    conflict.getByRole("button", { name: "认领", exact: true }),
  );
  await expect(
    conflict.getByRole("status").filter({ hasText: "该条目已被陈墨认领" }),
  ).toBeVisible();
  await expect(conflict.getByText("陈墨", { exact: true })).toBeVisible();
  await expect(conflict.getByRole("textbox")).toHaveCount(0);
  expect(
    await publicPage.evaluate(() =>
      sessionStorage.getItem("claimlist:draft:claims"),
    ),
  ).not.toContain("我的未提交姓名");
  mkdirSync("docs/screenshots", { recursive: true });
  await publicPage.screenshot({
    path: "docs/screenshots/claim-conflict-tip.png",
    fullPage: true,
  });
  await expect(conflict.getByText("该条目已被陈墨认领")).toHaveCount(0, {
    timeout: 7000,
  });
  await publicPage.reload();
  await expect(conflict.getByText("陈墨", { exact: true })).toBeVisible();
  await expect(conflict.getByRole("textbox")).toHaveCount(0);
  const beforeCancel = mutations;
  expect(
    await confirmAction(claim.getByRole("button", { name: "标记完成" }), false),
  ).toBe("确定将“实现首页”标记为已完成吗？");
  await expect(claim.getByText("进行中", { exact: true })).toBeVisible();
  expect(mutations).toBe(beforeCancel);
  await confirmAction(claim.getByRole("button", { name: "标记完成" }));
  await expect(claim.getByText("已完成", { exact: true })).toBeVisible();
  await expect(publicPage.getByRole("article").last()).toHaveAttribute(
    "aria-label",
    "实现首页",
  );
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  const adminItem = page.getByRole("article", {
    name: "实现首页",
    exact: true,
  });
  await expect(adminItem.getByText("已完成", { exact: true })).toBeVisible();
  await adminItem.getByRole("button", { name: "更正姓名" }).click();
  await page.getByLabel("显示姓名", { exact: true }).fill("林晓（前端）");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(
    adminItem.getByText("林晓（前端）", { exact: true }),
  ).toBeVisible();
  await adminItem.getByRole("button", { name: "重新打开" }).click();
  await expect(adminItem.getByText("进行中", { exact: true })).toBeVisible();
  await expect(page.getByRole("article").first()).toHaveAttribute(
    "aria-label",
    "实现首页",
  );
  await publicPage.getByRole("button", { name: "刷新列表" }).click();
  await expect(claim.getByRole("button", { name: "标记完成" })).toBeVisible();
  expect(
    await confirmAction(
      adminItem.getByRole("button", { name: "代为完成" }),
      false,
    ),
  ).toBe("确定代为完成“实现首页”吗？");
  await expect(adminItem.getByText("进行中", { exact: true })).toBeVisible();
  await confirmAction(adminItem.getByRole("button", { name: "代为完成" }));
  // Lost response after a committed mutation: keep draft and reload authoritative data.
  const uncertain = publicPage.getByRole("article", {
    name: "补充使用说明",
    exact: true,
  });
  await uncertain.getByRole("textbox").fill("周宁");
  await publicPage.route("**/api/action", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await confirmAction(
    uncertain.getByRole("button", { name: "认领", exact: true }),
  );
  await expect(publicPage.getByText(/暂时无法确认结果/)).toBeVisible();
  await expect(uncertain.getByLabel("未提交姓名草稿")).toHaveValue("周宁");
  await expect(uncertain.getByText("进行中", { exact: true })).toBeVisible();
  await publicPage.unroute("**/api/action");
  await publicPage.route("**/api/list", (route) => route.abort("failed"));
  await publicPage.getByRole("button", { name: "刷新列表" }).click();
  await expect(publicPage.getByText(/更新失败/)).toBeVisible();
  await expect(claim.getByRole("heading", { name: "实现首页" })).toBeVisible();
  await publicPage.unroute("**/api/list");
  await page.getByLabel("清单名称", { exact: true }).fill("开发任务");
  await page.getByLabel("简短说明").fill("把值得做的事情列出来，一起完成。");
  await page.getByRole("button", { name: "保存文案" }).click();
  await publicPage.getByRole("button", { name: "刷新列表" }).click();
  await expect(
    publicPage.getByRole("heading", { name: "开发任务", exact: true }),
  ).toBeVisible();
  await batch.fill("优化移动端布局\n验证数据恢复");
  await page.getByRole("button", { name: "添加条目", exact: true }).click();
  await expect(page.getByText("已新增 2 个条目")).toBeVisible();
  await publicPage.getByRole("button", { name: "刷新列表" }).click();
  await expect(publicPage.getByRole("article")).toHaveCount(5);
  const renamedDraft = publicPage.getByLabel("认领 优化移动端布局 的姓名");
  await renamedDraft.fill("标题变化草稿");
  await page
    .getByRole("article", { name: "优化移动端布局", exact: true })
    .getByRole("button", { name: "修改标题" })
    .click();
  await page.getByLabel("新标题", { exact: true }).fill("优化手机布局");
  await page.getByRole("button", { name: "保存修改" }).click();
  await publicPage.getByRole("button", { name: "刷新列表" }).click();
  await expect(
    publicPage.getByText("标题已更新，请核对最新内容；姓名草稿已保留。"),
  ).toBeVisible();
  await expect(publicPage.getByLabel("认领 优化手机布局 的姓名")).toHaveValue(
    "标题变化草稿",
  );
  await publicPage.getByLabel("认领 优化手机布局 的姓名").fill("");

  await uncertain.getByRole("button", { name: "清除草稿" }).click();
  await publicPage.reload();
  await expect(
    publicPage.getByRole("heading", { name: "开发任务", exact: true }),
  ).toBeVisible();
  mkdirSync("docs/screenshots", { recursive: true });
  await publicPage.setViewportSize({ width: 1440, height: 1000 });
  await publicPage.screenshot({
    path: "docs/screenshots/list-desktop.png",
    fullPage: true,
  });
  await publicPage.setViewportSize({ width: 390, height: 844 });
  expect(
    await publicPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await publicPage.screenshot({
    path: "docs/screenshots/list-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.screenshot({
    path: "docs/screenshots/admin-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Stale editor remains available and cannot overwrite a newer revision.
  await adminItem.getByRole("button", { name: "修改标题" }).click();
  await page.getByLabel("新标题", { exact: true }).fill("首页草稿");
  await adminItem.getByRole("button", { name: "重新打开" }).click();
  await expect(
    page.getByText("条目已变化，请核对列表中的最新内容。草稿已保留。"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "保存修改" })).toBeDisabled();
  await expect(page.getByLabel("新标题")).toHaveValue("首页草稿");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "丢弃草稿" }).click();
  page.once("dialog", (d) => d.accept());
  await adminItem.getByRole("button", { name: "释放认领" }).click();
  await expect(adminItem.getByText("待认领", { exact: true })).toBeVisible();
  await expect(adminItem.getByRole("button", { name: "代为完成" })).toHaveCount(
    0,
  );
  page.once("dialog", (d) => d.accept());
  await adminItem.getByRole("button", { name: "删除", exact: true }).click();
  await expect(adminItem).toHaveCount(0);
  await batch.fill("实现首页");
  await page.getByRole("button", { name: "添加条目", exact: true }).click();
  await expect(adminItem.getByText("待认领", { exact: true })).toBeVisible();
  // Storage failure must be explicit while still supporting the current visit.
  const noStorage = await browser.newContext();
  await noStorage.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked");
      },
    });
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new Error("blocked");
      },
    });
  });
  const privatePage = await noStorage.newPage();
  await privatePage.goto(origin);
  await expect(privatePage.getByText(/浏览器存储不可用/)).toBeVisible();
  await noStorage.close();
  const second = await browser.newContext();
  const secondPage = await second.newPage();
  await secondPage.goto(`${origin}/admin`);
  await secondPage.getByLabel("管理密码", { exact: true }).fill(pass);
  await secondPage.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    secondPage.getByRole("heading", { name: "管理清单", exact: true }),
  ).toBeVisible();
  await page.getByLabel("当前密码", { exact: true }).fill(pass);
  await page.getByLabel("新密码", { exact: true }).fill("new-browser-password");
  await page
    .getByLabel("确认新密码", { exact: true })
    .fill("new-browser-password");
  await page.getByRole("button", { name: "修改密码并退出" }).click();
  await expect(page.getByRole("heading", { name: "管理员登录" })).toBeVisible();
  await secondPage.getByLabel("批量条目").fill("会话过期草稿");
  await secondPage
    .getByRole("button", { name: "添加条目", exact: true })
    .click();
  await expect(
    secondPage.getByText("管理会话已失效，请重新登录"),
  ).toBeVisible();
  await expect(
    secondPage.getByRole("heading", { name: "管理员登录" }),
  ).toBeVisible();
  await page
    .getByLabel("管理密码", { exact: true })
    .fill("new-browser-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "管理清单", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "退出管理" }).click();
  await expect(page.getByRole("heading", { name: "管理员登录" })).toBeVisible();
  expect(errors).toEqual([]);
  await second.close();
  await participant.close();
});

test("可见时定时刷新、隐藏时暂停、获得焦点刷新并保留草稿", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  const input = page.getByLabel("认领 实现首页 的姓名");
  await expect(input).toBeVisible();
  await input.fill("保持草稿");
  let requests = 0;
  page.on("request", (req) => {
    if (req.url().endsWith("/api/list")) requests++;
  });
  await page.clock.fastForward(30000);
  await expect.poll(() => requests).toBeGreaterThan(0);
  await expect(input).toHaveValue("保持草稿");
  await page.evaluate(() =>
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    }),
  );
  const before = requests;
  await page.clock.fastForward(30000);
  expect(requests).toBe(before);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    window.dispatchEvent(new Event("focus"));
  });
  await expect.poll(() => requests).toBeGreaterThan(before);
  await expect(input).toHaveValue("保持草稿");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
    "BODY",
  );
});

test("可选账号完整流程：绑定、跨设备、账号切换、重置、过期认领及移动布局", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const api = page.context().request;
  const adminLogin = await action(api, {
    action: "login",
    password: "new-browser-password",
  });
  expect(adminLogin.ok()).toBeTruthy();
  expect(
    (
      await action(api, {
        action: "batch",
        text: "账号进行中\n账号已完成\n账号新任务\n账号草稿\n过期认领",
      })
    ).ok(),
  ).toBeTruthy();
  const aContext = await browser.newContext();
  const a = await aContext.newPage();
  const errors: string[] = [];
  a.on("pageerror", (error) => errors.push(error.message));
  await a.goto(origin);
  const panel = a.getByRole("region", { name: "参与者账号" });
  await expect(panel.getByRole("button", { name: "暂不登录" })).toHaveCount(0);
  await a.reload();
  await expect(
    panel.getByText("正在匿名使用。登录后可跨设备管理已认领的任务。", {
      exact: true,
    }),
  ).toBeVisible();
  const row = (title: string) =>
    a.getByRole("article", { name: title, exact: true });
  for (const title of ["账号进行中", "账号已完成"]) {
    await row(title).getByRole("textbox").fill("历史显示名");
    await confirmAction(
      row(title).getByRole("button", { name: "认领", exact: true }),
    );
    await expect(
      row(title).getByText("历史显示名", { exact: true }),
    ).toBeVisible();
  }
  await confirmAction(
    row("账号已完成").getByRole("button", { name: "标记完成" }),
  );
  await expect(
    row("账号已完成").getByText("已完成", { exact: true }),
  ).toBeVisible();
  await row("账号草稿").getByRole("textbox").fill("不应丢失");
  await panel.getByRole("button", { name: "注册账号" }).click();
  await panel.getByLabel("邮箱", { exact: true }).fill("Alpha@Example.com");
  await panel.getByLabel("姓名", { exact: true }).fill("账号甲");
  await panel.getByLabel("密码", { exact: true }).fill("12345678");
  await panel.getByLabel("确认密码", { exact: true }).fill("12345678");
  await a.screenshot({
    path: "docs/screenshots/account-register.png",
    fullPage: true,
  });
  await panel.getByRole("button", { name: "注册并登录" }).click();
  await expect(
    panel.getByText("已将当前浏览器认领的 2 个任务关联到你的账号"),
  ).toBeVisible();
  await expect(
    row("账号进行中").getByText("历史显示名", { exact: true }),
  ).toBeVisible();
  await expect(row("账号新任务").getByRole("textbox")).toHaveCount(0);
  expect(
    await confirmAction(
      row("账号新任务").getByRole("button", { name: "认领", exact: true }),
      false,
    ),
  ).toBe("确定以“账号甲”认领“账号新任务”吗？");
  await expect(
    row("账号新任务").getByText("待认领", { exact: true }),
  ).toBeVisible();
  await confirmAction(
    row("账号新任务").getByRole("button", { name: "认领", exact: true }),
  );
  await expect(
    row("账号新任务").getByText("账号甲", { exact: true }),
  ).toBeVisible();
  const list = await (await aContext.request.get(`${origin}/api/list`)).json();
  const pendingId = list.items.find(
    (i: { title: string }) => i.title === "账号进行中",
  ).id;
  const accountId = list.participant.id;
  expect(JSON.stringify(list)).not.toContain("alpha@example.com");
  expect(
    (
      await action(aContext.request, {
        action: "participant-search",
        query: "",
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await action(aContext.request, {
        action: "participant-reset",
        id: accountId,
        password: "87654321",
        confirm: "87654321",
      })
    ).status(),
  ).toBe(401);
  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  await second.goto(origin);
  await second.getByRole("button", { name: "登录账号" }).click();
  await second.getByLabel("邮箱", { exact: true }).fill("alpha@example.com");
  await second.getByLabel("密码", { exact: true }).fill("12345678");
  await second.getByRole("button", { name: "登录", exact: true }).click();
  await expect(second.getByText("当前账号：")).toContainText("账号甲");
  await confirmAction(
    second
      .getByRole("article", { name: "账号进行中", exact: true })
      .getByRole("button", { name: "标记完成" }),
  );
  await expect(
    second
      .getByRole("article", { name: "账号进行中", exact: true })
      .getByText("已完成", { exact: true }),
  ).toBeVisible();
  a.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toContain("确定退出当前账号");
    await dialog.dismiss();
  });
  await panel.getByRole("button", { name: "退出账号" }).click();
  await expect(panel.getByText("当前账号：")).toContainText("账号甲");
  a.once("dialog", (dialog) => dialog.accept());
  await panel.getByRole("button", { name: "退出账号" }).click();
  await expect(row("账号草稿").getByRole("textbox")).toHaveValue("不应丢失");
  await expect(
    row("账号新任务").getByRole("button", { name: "标记完成" }),
  ).toHaveCount(0);
  await expect(
    row("账号新任务").getByRole("button", { name: "登录后完成" }),
  ).toBeVisible();
  expect(
    (
      await action(aContext.request, { action: "complete", id: pendingId })
    ).status(),
  ).toBe(403);
  await panel.getByRole("button", { name: "注册账号" }).click();
  await panel.getByLabel("邮箱", { exact: true }).fill("beta@example.com");
  await panel.getByLabel("姓名", { exact: true }).fill("账号乙");
  await panel.getByLabel("密码", { exact: true }).fill("12345678");
  await panel.getByLabel("确认密码", { exact: true }).fill("12345678");
  await panel.getByRole("button", { name: "注册并登录" }).click();
  await expect(panel.getByText("当前账号：")).toContainText("账号乙");
  expect(
    (
      await action(aContext.request, { action: "complete", id: pendingId })
    ).status(),
  ).toBe(403);
  await expect(
    row("账号新任务").getByRole("button", { name: "标记完成" }),
  ).toHaveCount(0);
  // Reset A through the actual management UI; B and the administrator remain signed in.
  await page.goto("/admin");
  const management = page.getByRole("region", { name: "参与者密码管理" });
  await management.getByLabel("查找参与者").fill("alpha@example.com");
  await management.getByRole("button", { name: "查找账号" }).click();
  await management
    .getByRole("button", { name: "账号甲 · alpha@example.com" })
    .click();
  await management.getByLabel("参与者新密码", { exact: true }).fill("87654321");
  await management
    .getByLabel("确认参与者新密码", { exact: true })
    .fill("87654321");
  await page.screenshot({
    path: "docs/screenshots/account-admin.png",
    fullPage: true,
  });
  page.once("dialog", (dialog) => dialog.accept());
  await management.getByRole("button", { name: "重置参与者密码" }).click();
  await expect(management.getByText(/参与者密码已重置/)).toBeVisible();
  // The old screen still thinks A is logged in. Its claim must fail instead of becoming anonymous.
  const expired = second.getByRole("article", {
    name: "过期认领",
    exact: true,
  });
  await confirmAction(
    expired.getByRole("button", { name: "认领", exact: true }),
  );
  await expect(second.getByText(/登录状态已变化/)).toBeVisible();
  await expect(expired.getByRole("textbox")).toBeVisible();
  await expect(second.getByText("当前账号：")).toHaveCount(0);
  await second.getByRole("button", { name: "登录账号" }).click();
  await second.getByLabel("密码", { exact: true }).fill("12345678");
  await second.getByRole("button", { name: "登录", exact: true }).click();
  await expect(second.getByText("邮箱或密码不正确")).toBeVisible();
  await second.getByLabel("密码", { exact: true }).fill("87654321");
  await second.getByRole("button", { name: "登录", exact: true }).click();
  await expect(second.getByText("当前账号：")).toContainText("账号甲");
  await expect(
    second
      .getByRole("article", { name: "账号新任务", exact: true })
      .getByRole("button", { name: "标记完成" }),
  ).toBeVisible();
  await a.getByRole("button", { name: "刷新列表" }).click();
  await expect(panel.getByText("当前账号：")).toContainText("账号乙");
  await second.setViewportSize({ width: 390, height: 844 });
  await second.screenshot({
    path: "docs/screenshots/account-mobile.png",
    fullPage: true,
  });
  expect(
    await second.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  const stored = await a.evaluate(() =>
    JSON.stringify({ ...sessionStorage, ...localStorage }),
  );
  expect(stored).not.toContain("12345678");
  expect(stored).not.toContain("87654321");
  // A second tab receives the identity change without losing its anonymous draft.
  const twin = await aContext.newPage();
  await twin.goto(origin);
  await expect(twin.getByText("当前账号：")).toContainText("账号乙");
  a.once("dialog", (dialog) => dialog.accept());
  await panel.getByRole("button", { name: "退出账号" }).click();
  await expect(twin.getByText("当前账号：")).toHaveCount(0);
  await expect(row("账号草稿").getByRole("textbox")).toHaveValue("不应丢失");
  // A committed login with a lost response must refresh state without claiming success.
  await panel.getByRole("button", { name: "登录账号" }).click();
  await panel.getByLabel("邮箱", { exact: true }).fill("beta@example.com");
  await panel.getByLabel("密码", { exact: true }).fill("12345678");
  await a.route(
    "**/api/participant",
    async (route) => {
      await route.fetch();
      await route.abort();
    },
    { times: 1 },
  );
  await panel.getByRole("button", { name: "登录", exact: true }).click();
  await expect(panel.getByText(/暂时无法确认结果/)).toBeVisible();
  await a.reload();
  await expect(panel.getByText("当前账号：")).toContainText("账号乙");
  await expect(twin.getByText("当前账号：")).toContainText("账号乙");
  // Login and claims still work for this visit with both storage APIs blocked.
  const noStorage = await browser.newContext();
  await noStorage.addInitScript(() => {
    for (const key of ["localStorage", "sessionStorage"])
      Object.defineProperty(window, key, {
        get() {
          throw new Error("blocked");
        },
      });
  });
  const privatePage = await noStorage.newPage();
  await privatePage.goto(origin);
  await expect(privatePage.getByText(/浏览器存储不可用/)).toBeVisible();
  await privatePage.getByRole("button", { name: "登录账号" }).click();
  await privatePage
    .getByLabel("邮箱", { exact: true })
    .fill("beta@example.com");
  await privatePage.getByLabel("密码", { exact: true }).fill("12345678");
  await privatePage.getByRole("button", { name: "登录", exact: true }).click();
  await expect(privatePage.getByText("当前账号：")).toContainText("账号乙");
  await confirmAction(
    privatePage
      .getByRole("article", { name: "过期认领", exact: true })
      .getByRole("button", { name: "认领", exact: true }),
  );
  await expect(
    privatePage
      .getByRole("article", { name: "过期认领", exact: true })
      .getByText("账号乙", { exact: true }),
  ).toBeVisible();
  await noStorage.close();
  expect(errors).toEqual([]);
  await aContext.close();
  await secondContext.close();
});
