import { expect, type Page, type Route, test } from "@playwright/test";

const timestamp = "2026-10-19T00:00:00Z";
const profiles = [
  { id: "11", name: "Alpha 配置", model: "alpha-model", format: "openai", is_default: true },
  { id: "22", name: "Beta 配置", model: "beta-model", format: "openai", is_default: false },
];
const fixtureTask = {
  id: "42",
  name: "控件回归任务",
  description: "控件回归任务",
  goal: "只验证界面",
  status: "paused",
  created_at: timestamp,
  llm_profile_ids: [11],
  active_llm_profile_id: 11,
  coverage_enabled: false,
};

async function fixture(page: Page, override?: (route: Route, path: string) => Promise<boolean>) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("liora_token", "fixture.eyJzdWIiOiJMaW9yYSJ9.fixture"));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (await override?.(route, path)) return;
    let json: unknown = {};
    if (path === "/api/tasks") json = { tasks: [fixtureTask], active: "" };
    else if (path === "/api/tasks/42") json = fixtureTask;
    else if (path === "/api/llm/profiles") json = { profiles };
    else if (path === "/api/task-categories") json = { categories: [{ id: 1, name: "Web 分类", task_count: 0 }] };
    else if (path === "/api/task-templates")
      json = { templates: [{ id: 7, name: "Web 模板", description: "模板对象", goal: "模板目标" }] };
    else if (path === "/api/settings") json = { workers: 3 };
    else if (path === "/api/conversations/7")
      json = { id: 7, title: "引用回归会话", agent_key: "worker", created_at: timestamp };
    else if (path === "/api/agents") json = { agents: [{ key: "worker", name: "Worker", builtin: true }] };
    else if (path.endsWith("/side-questions")) json = { items: [], next_cursor: 0, snapshot: null };
    else if (/\/messages$/.test(path)) json = { items: [], cursor: 0, hasMore: false, running: false };
    await route.fulfill({ json });
  });
  return errors;
}

test("select labels render before opening and keyboard selection returns focus", async ({ page }) => {
  const errors = await fixture(page);
  await page.goto("/system/settings");
  const select = page.getByRole("combobox", { name: /发送方式/ });
  await expect(select).toHaveText("Enter 发送，Shift+Enter 换行");
  await select.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(page.getByRole("option", { name: "Enter 发送，Shift+Enter 换行", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("option", { name: "Ctrl+Enter 发送，Enter 换行", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(select).toHaveText("Ctrl+Enter 发送，Enter 换行");
  await expect(select).toBeFocused();
  await select.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(select).toBeFocused();
  expect(errors).toEqual([]);
});

test("template search, clearing and category creation preserve the task drawer", async ({ page }) => {
  const created: string[] = [];
  const errors = await fixture(page, async (route, path) => {
    if (path !== "/api/task-categories" || route.request().method() !== "POST") return false;
    const name = route.request().postDataJSON().name;
    created.push(name);
    await route.fulfill({ json: { id: 8, name, task_count: 0 } });
    return true;
  });
  await page.goto("/function/tasks");
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "新建任务", exact: true });
  const template = drawer.getByRole("combobox", { name: "任务模板", exact: true });
  await template.fill("Web");
  await expect(page.getByRole("option")).toHaveCount(1);
  await template.press("Enter");
  await expect(drawer.getByLabel("描述", { exact: true })).toHaveValue("模板对象");
  await expect(drawer.getByLabel("目标", { exact: true })).toHaveValue("模板目标");
  await drawer.getByRole("button", { name: "清除选择" }).click();
  await expect(template).toHaveValue("");
  await template.fill("不存在");
  await expect(drawer.getByText("没有匹配的模板")).toBeVisible();
  await template.press("Escape");
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: /高级设置/ }).click();
  const category = drawer.getByRole("combobox", { name: "任务分类", exact: true });
  await category.fill("Web");
  await category.press("Enter");
  const chip = drawer.locator('[data-slot="combobox-chip"]');
  await expect(chip).toContainText("Web 分类");
  await chip.locator('[aria-label="移除 Web 分类"]').click();
  await expect(chip).toHaveCount(0);
  await category.fill("新分类");
  await category.press("Enter");
  await expect.poll(() => created).toEqual(["新分类"]);
  await expect(chip).toContainText("新分类");
  await expect(drawer).toBeVisible();
  expect(errors).toEqual([]);
});

test("profile multiselect keeps chips, nested Escape and disabled save semantics", async ({ page }) => {
  let finishSave: (() => void) | undefined;
  let saving = false;
  const errors = await fixture(page, async (route, path) => {
    if (path !== "/api/tasks/42/llm") return false;
    saving = true;
    await new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    await route.fulfill({ json: { id: "42", reopened_intents: 0 } });
    return true;
  });
  await page.goto("/function/tasks/detail?id=42");
  const trigger = page.getByRole("button", { name: "查看或切换任务 LLM 配置" });
  await trigger.click();
  const popover = page.locator('[data-slot="popover-content"]').filter({ hasText: "任务 LLM 配置链" });
  const input = popover.locator("#task-llm-profiles");
  await input.fill("beta");
  await expect(page.getByRole("option", { name: /Beta 配置/ })).toBeVisible();
  await input.press("Enter");
  await expect(popover.locator('[data-slot="combobox-chip"]')).toHaveCount(2);
  await expect(input).toBeFocused();
  await input.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: "移除 Alpha 配置", exact: true }).click();
  await expect(popover.locator('[data-slot="combobox-chip"]')).toHaveCount(1);
  await popover.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => saving).toBe(true);
  await expect(input).toBeDisabled();
  await expect(popover.locator('[data-slot="select-trigger"]')).toBeDisabled();
  finishSave?.();
  await expect(popover).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});

test("mention anchor keeps typing focus and Escape dismisses only its candidates", async ({ page }) => {
  const errors = await fixture(page);
  await page.goto("/function/conversations/detail?c=7");
  const input = page.getByRole("textbox", { name: "消息，输入 @ 引用记录" });
  await input.fill("@");
  const candidates = page.getByRole("dialog", { name: "选择引用记录" });
  await expect(candidates).toBeVisible();
  await expect(input).toBeFocused();
  const inputBox = await input.boundingBox();
  const popupBox = await candidates.boundingBox();
  expect(popupBox!.y + popupBox!.height).toBeLessThanOrEqual(inputBox!.y + 2);
  await input.press("ArrowDown");
  await expect(candidates.getByRole("option", { name: "资产", exact: true })).toHaveAttribute("aria-selected", "true");
  await input.press("Escape");
  await expect(candidates).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("@");
  expect(errors).toEqual([]);
});

test("nested select Escape preserves the popover and dropdown keyboard focus returns", async ({ page }) => {
  const errors = await fixture(page);
  // 重构后顶栏不再有「布局与外观偏好」弹层（随左侧导航一起移除），
  // 现在唯一带嵌套 Select 的浮层是任务详情页的「任务 LLM 配置链」Popover：
  // 用它继续守住「Esc 只关一层」的语义。
  await page.goto("/function/tasks/detail?id=42");
  const popoverTrigger = page.getByRole("button", { name: "查看或切换任务 LLM 配置" });
  await expect(popoverTrigger).toBeVisible();
  await popoverTrigger.click();
  const popover = page.locator('[data-slot="popover-content"]');
  await expect(popover).toBeVisible();
  const select = popover.locator('[data-slot="select-trigger"]');
  await select.focus();
  await select.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(popover).toBeVisible();
  await expect(select).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(popoverTrigger).toBeFocused();

  const account = page.getByRole("button", { name: "账户菜单：Liora" });
  await account.focus();
  await account.press("ArrowDown");
  const changeAvatar = page.getByRole("menuitem", { name: "更换头像" });
  await expect(changeAvatar).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const changePassword = page.getByRole("menuitem", { name: "修改密码" });
  await expect(changePassword).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "退出登录" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(account).toBeFocused();
  expect(errors).toEqual([]);
});
