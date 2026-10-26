import { signIn } from "./helpers";
import { fixtureDashboard } from "./fixtures";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
for (const theme of ["light", "dark"])
  test(`${theme} key screens meet automated accessibility checks`, async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2026-10-24T04:00:00Z") });
    await page.addInitScript(
      (value) => localStorage.setItem("vl-theme", value),
      theme,
    );
    await page.goto("/");
    let scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(scan.violations).toEqual([]);
    await signIn(page, fixtureDashboard(new Date("2026-10-24T04:00:00Z")));
    scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    await page.screenshot({
      path: `/tmp/attendance-${theme}-glass.png`,
      fullPage: true,
    });
    expect(
      scan.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    ).toEqual([]);
    await page
      .getByRole("button", { name: "Calendar", exact: true })
      .first()
      .click();
    const calendarScan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      calendarScan.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    ).toEqual([]);
    await page.screenshot({
      path: `/tmp/attendance-${theme}-calendar.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Settings", exact: true })
      .first()
      .click();
    const profileScan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(profileScan.violations).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/attendance-${theme}-settings.png`,
      fullPage: true,
    });
  });
