import { test, expect, type Browser, type Page } from "@playwright/test";

async function guest(browser: Browser, code: string, name: string) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:3187/r/${code}`);
  await page.getByLabel("닉네임").fill(name);
  await page.getByRole("button", { name: "입장하기", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "대기실", exact: true }),
  ).toBeVisible();
  return { context, page };
}
async function ready(pages: Page[]) {
  for (const page of pages)
    await page.getByRole("button", { name: "준비 완료", exact: true }).click();
  await pages[0]
    .getByRole("button", { name: "게임 시작", exact: true })
    .click();
}
test("세 기기의 사다리, 새로고침 복귀, 카드, 기록과 로컬 모드", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("link", { name: "각자 폰으로 하기", exact: false })
    .click();
  await page.getByLabel("닉네임").fill("방장");
  await page.getByRole("button", { name: "방 만들기", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "대기실", exact: true }),
  ).toBeVisible();
  const code = page.url().split("/").at(-1)!;
  const a = await guest(browser, code, "민수"),
    b = await guest(browser, code, "지수");
  const pages = [page, a.page, b.page];
  await expect(page.locator(".online-members li")).toHaveCount(3);
  await page.screenshot({ path: "test-results/lobby.png", fullPage: true });
  await ready(pages);
  await expect(
    page.getByRole("button", { name: "내 사다리 공개", exact: true }),
  ).toBeEnabled({ timeout: 10000 });
  await page
    .getByRole("button", { name: "내 사다리 공개", exact: true })
    .click();
  await a.page.reload();
  await a.page.getByRole("button", { name: "입장하기", exact: true }).click();
  await expect(
    a.page.getByRole("button", { name: "내 사다리 공개", exact: true }),
  ).toBeEnabled();
  await a.page
    .getByRole("button", { name: "내 사다리 공개", exact: true })
    .click();
  await b.page
    .getByRole("button", { name: "내 사다리 공개", exact: true })
    .click();
  for (const p of pages)
    await expect(
      p.getByRole("heading", { name: "이번 판 결과", exact: true }),
    ).toBeVisible();
  const result = await page.locator(".online-result .award-list").innerText();
  for (const p of pages)
    expect(await p.locator(".online-result .award-list").innerText()).toBe(
      result,
    );
  await page.screenshot({ path: "test-results/result.png", fullPage: true });
  await page.getByRole("button", { name: "다음 판 준비하기" }).click();
  await page.getByLabel("게임", { exact: true }).selectOption("cards");
  await page.getByRole("button", { name: "설정 적용", exact: true }).click();
  await ready(pages);
  await expect(
    page.getByRole("button", { name: "1번 카드", exact: true }),
  ).toBeEnabled({ timeout: 10000 });
  await expect(
    a.page.getByRole("button", { name: "1번 카드", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "1번 카드", exact: true }).click();
  await a.page.getByRole("button", { name: "2번 카드", exact: true }).click();
  await b.page.getByRole("button", { name: "3번 카드", exact: true }).click();
  for (const p of pages)
    await expect(
      p.getByRole("heading", { name: "이번 판 결과", exact: true }),
    ).toBeVisible();
  await page.goto("/");
  await page.getByRole("button", { name: "기록", exact: true }).click();
  await expect(page.locator(".history-list>li")).toHaveCount(2);
  await page.goto("/");
  await page
    .getByRole("button", { name: "한 기기로 하기", exact: false })
    .click();
  await expect(
    page.getByRole("heading", { name: "누가 참가하나요?" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await a.context.close();
  await b.context.close();
});
test("나머지 일곱 게임의 실제 화면과 완료 결과", async ({ page, browser }) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/online?mode=create");
  await page.getByLabel("닉네임").fill("방장");
  await page.getByRole("button", { name: "방 만들기", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "대기실", exact: true }),
  ).toBeVisible();
  const friend = await guest(browser, page.url().split("/").at(-1)!, "친구");
  friend.page.on("pageerror", (e) => errors.push(e.message));
  for (const game of [
    "roulette",
    "scratch",
    "pirate",
    "bomb",
    "stopwatch",
    "horse",
    "marble",
  ]) {
    await page.getByLabel("게임", { exact: true }).selectOption(game);
    await page.getByRole("button", { name: "설정 적용", exact: true }).click();
    await ready([page, friend.page]);
    const result = page.getByRole("heading", {
      name: "이번 판 결과",
      exact: true,
    });
    if (game === "roulette") {
      const spin = page.getByRole("button", {
        name: "룰렛 돌리기",
        exact: true,
      });
      await expect(spin).toBeEnabled({ timeout: 10000 });
      await spin.click();
      await expect(page.locator(".online-wheel")).toHaveClass(/rolling/);
    }
    if (game === "scratch") {
      for (const p of [page, friend.page]) {
        const btn = p.getByRole("button", { name: "버튼으로 복권 공개" });
        await expect(btn).toBeEnabled({ timeout: 10000 });
        await btn.click();
      }
    }
    if (game === "pirate" || game === "bomb") {
      await expect(
        page.locator(game === "pirate" ? ".online-pirate" : ".online-bomb"),
      ).toBeVisible({ timeout: 10000 });
      const deadline = Date.now() + 45000;
      while (!(await result.isVisible()) && Date.now() < deadline) {
        for (const p of [page, friend.page]) {
          const button = p
            .locator(
              game === "pirate"
                ? ".online-holes button:enabled"
                : ".online-bomb:enabled",
            )
            .first();
          if (await button.count()) {
            await button.click();
          }
        }
        await page.waitForTimeout(100);
      }
    }
    if (game === "stopwatch") {
      for (const p of [page, friend.page])
        await expect(
          p.getByRole("button", { name: "측정 시작", exact: true }),
        ).toBeEnabled({ timeout: 10000 });
      await page
        .getByRole("button", { name: "측정 시작", exact: true })
        .click();
      await page.waitForTimeout(1200);
      await page.getByRole("button", { name: "멈춤!", exact: true }).click();
      await friend.page
        .getByRole("button", { name: "측정 시작", exact: true })
        .click();
      await friend.page.waitForTimeout(2200);
      await friend.page
        .getByRole("button", { name: "멈춤!", exact: true })
        .click();
    }
    if (game === "horse" || game === "marble") {
      await expect(
        page.locator(game === "horse" ? ".online-race" : ".online-marble"),
      ).toBeVisible({ timeout: 15000 });
      await page.screenshot({
        path: `test-results/${game}.png`,
        fullPage: true,
      });
    }
    await expect(result).toBeVisible({ timeout: 100000 });
    await expect(
      friend.page.getByRole("heading", { name: "이번 판 결과", exact: true }),
    ).toBeVisible();
    expect(await page.locator(".online-result .award-list").innerText()).toBe(
      await friend.page.locator(".online-result .award-list").innerText(),
    );
    await page.getByRole("button", { name: "다음 판 준비하기" }).click();
  }
  expect(errors).toEqual([]);
  await friend.context.close();
});
