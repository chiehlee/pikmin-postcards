import { expect, test } from '@playwright/test';

test('friend footprints can expand and collapse every friend with one control', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '朋友足跡' }).click();

  const details = page.locator('.friend-details');
  const expandAll = page.getByRole('button', { name: '全部展開' });
  await expect(details.first()).toBeAttached();
  const friendCount = await details.count();
  expect(friendCount).toBeGreaterThan(0);
  await expect(page.locator('.friend-details[open]')).toHaveCount(0);
  await expect(expandAll).toHaveAttribute('aria-expanded', 'false');
  await expect(expandAll).toHaveAttribute('aria-controls', 'friend-grid');

  await expandAll.click();
  await expect(page.locator('.friend-details[open]')).toHaveCount(friendCount);
  const collapseAll = page.getByRole('button', { name: '全部收合' });
  await expect(collapseAll).toHaveAttribute('aria-expanded', 'true');
  await expect(collapseAll).toBeFocused();

  await details.first().locator('summary').click();
  await expect(page.locator('.friend-details[open]')).toHaveCount(friendCount - 1);
  await expect(page.getByRole('button', { name: '全部展開' })).toHaveAttribute('aria-expanded', 'false');

  await page.getByRole('button', { name: '全部展開' }).click();
  await expect(page.locator('.friend-details[open]')).toHaveCount(friendCount);
  await page.getByRole('button', { name: '全部收合' }).click();
  await expect(page.locator('.friend-details[open]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '全部展開' })).toHaveAttribute('aria-expanded', 'false');
});

test('compact friend cards expand details and overflow postcards into an accessible popup', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: '朋友足跡' }).click();

  const friendCards = page.locator('.friend-card');
  await expect(friendCards.first()).toBeVisible();
  expect(await friendCards.count()).toBeGreaterThan(0);
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
  await page.locator('.friend-grid').evaluate((grid) => grid.scrollIntoView({ block: 'start' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const visibleNames = await friendCards.locator('.friend-name-row h3').evaluateAll((headings) => (
    headings.filter((heading) => {
      const box = heading.getBoundingClientRect();
      return box.top >= 0 && box.top < window.innerHeight;
    }).length
  ));
  expect(visibleNames).toBeGreaterThanOrEqual(testInfo.project.name === 'desktop-chromium' ? 6 : 2);
  expect(await friendCards.locator('.timeline').evaluateAll((timelines) => (
    timelines.every((timeline) => timeline.querySelectorAll(':scope > button').length <= 5)
  ))).toBe(true);

  const liuCard = friendCards.filter({ has: page.getByRole('heading', { name: '柳柳', exact: true }) });
  const fiveCardFriend = friendCards.filter({ has: page.getByRole('heading', { name: '花花', exact: true }) });
  const baseCard = friendCards.filter({ has: page.getByRole('heading', { name: '菎娜', exact: true }) });
  const details = liuCard.locator('.friend-details');
  const moreButton = liuCard.locator('.friend-more-button');
  await expect(details).not.toHaveAttribute('open', '');
  await expect(liuCard.locator('dl')).toBeHidden();
  await expect(moreButton).toBeHidden();
  await expect(baseCard.locator('.friend-name-row')).toContainText('菎娜可能據點 · 臺北市北投區');
  await expect(baseCard.locator('.friend-base-area')).toBeVisible();
  expect(await baseCard.locator('.friend-name-row').evaluate((row) => getComputedStyle(row).display)).toBe('flex');
  await expect(liuCard.locator('.timeline > button')).toHaveCount(5);
  await expect(fiveCardFriend.locator('.timeline > button')).toHaveCount(5);
  await expect(fiveCardFriend.locator('.friend-more-button')).toHaveCount(0);

  await liuCard.getByText('展開資料與明信片').click();
  await expect(details).toHaveAttribute('open', '');
  await expect(liuCard.locator('dl')).toBeVisible();
  await expect(moreButton).toBeVisible();
  await expect(moreButton).toContainText('另外 1 張');
  await moreButton.click();
  const dialog = page.locator('.friend-postcards-modal');
  const closeButton = dialog.getByRole('button', { name: '關閉朋友明信片' });
  const postcardButtons = dialog.locator('.friend-postcards-list > button');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '柳柳 的明信片' })).toBeVisible();
  await expect(dialog).toContainText('全部 6 張已確認寄件人觀察');
  await expect(postcardButtons).toHaveCount(6);
  await expect(page.locator('body')).toHaveClass(/modal-open/);
  await expect(closeButton).toBeFocused();
  expect(await dialog.locator('.friend-postcards-modal-scroll').evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto');

  await page.keyboard.press('Shift+Tab');
  await expect(postcardButtons.last()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(closeButton).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(moreButton).toBeFocused();
  await expect(page.locator('body')).not.toHaveClass(/modal-open/);

  await moreButton.click();
  await postcardButtons.first().click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.detail-modal')).toBeVisible();
  await page.keyboard.press('Escape');

  await moreButton.click();
  await page.locator('.friend-postcards-modal-backdrop').click({ position: { x: 4, y: 4 } });
  await expect(dialog).toBeHidden();
  await expect(moreButton).toBeFocused();
});

test('friend base evidence returned by the management API updates the friends UI without a rebuild', async ({ page }) => {
  await page.route('**/api/archive', async (route) => {
    const response = await route.fetch();
    const payload = await response.json() as {
      friends: Array<{
        name: string;
        likely_base: {
          area: string | null;
          status: string;
          confidence: string;
          confidence_label: string;
          reason: string;
        };
      }>;
    } & Record<string, unknown>;
    payload.friends = payload.friends.map((profile) => profile.name === '柳柳'
      ? {
        ...profile,
        likely_base: {
          area: '青森県弘前市',
          status: 'early-signal',
          confidence: 'medium',
          confidence_label: '中',
          reason: 'Playwright 模擬：有效地點證據變更後，只更新這位玩家。',
        },
      }
      : profile);
    await route.fulfill({ response, json: payload });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '朋友足跡' }).click();
  const card = page.locator('.friend-card').filter({ has: page.getByRole('heading', { name: '柳柳', exact: true }) });
  await expect(card.locator('.friend-name-row')).toContainText('可能據點 · 青森県弘前市');
  await card.getByText('展開資料與明信片').click();
  await expect(card).toContainText('Playwright 模擬：有效地點證據變更後，只更新這位玩家。');
});
