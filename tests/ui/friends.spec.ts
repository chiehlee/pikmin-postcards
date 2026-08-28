import { expect, test } from '@playwright/test';
import { createArchiveFixture, mockArchive } from './archive-fixture';

test.beforeEach(async ({ page }) => mockArchive(page));

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
    const payload = createArchiveFixture();
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
    await route.fulfill({ json: payload });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '朋友足跡' }).click();
  const card = page.locator('.friend-card').filter({ has: page.getByRole('heading', { name: '柳柳', exact: true }) });
  await expect(card.locator('.friend-name-row')).toContainText('可能據點 · 青森県弘前市');
  await card.getByText('展開資料與明信片').click();
  await expect(card).toContainText('Playwright 模擬：有效地點證據變更後，只更新這位玩家。');
});

test('friend editor prefills selectable values and searches merge targets by most recent modification', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '朋友足跡' }).click();
  const card = page.locator('.friend-card').filter({ has: page.getByRole('heading', { name: '菎娜', exact: true }) });
  await card.getByText('展開資料與明信片').click();
  await card.getByRole('button', { name: '編輯情報' }).click();

  const dialog = page.getByRole('dialog', { name: '編輯情報' });
  const name = dialog.getByLabel('名稱');
  const base = dialog.getByLabel('可能據點');
  await expect(dialog).toBeVisible();
  await expect(name).toHaveValue('菎娜');
  await expect(base).toHaveValue('臺北市北投區');
  await name.click();
  expect(await name.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([0, '菎娜'.length]);
  await base.click();
  expect(await base.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([0, '臺北市北投區'.length]);

  await dialog.getByRole('button', { name: '合併寄件者' }).click();
  const options = dialog.locator('.friend-merge-list > button');
  await expect(options.first()).toContainText('柳柳');
  await dialog.getByLabel('搜尋寄件者').fill('Alice');
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText('Alice');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(card.getByRole('button', { name: '編輯情報' })).toBeFocused();
});

test('friend editor saves, recrops, and soft-deletes without deleting associated postcards', async ({ page }) => {
  await page.unroute('**/api/archive');
  const payload = createArchiveFixture();
  await page.route('**/api/archive', async (route) => route.fulfill({ json: payload }));
  let avatarCalls = 0;
  await page.route(/\/api\/friends\/[^/]+\/avatar$/, async (route) => {
    avatarCalls += 1;
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2)!);
    const friend = payload.friends.find((profile) => profile.name === name)!;
    friend.modified_at = '2026-08-28T02:03:04Z';
    friend.avatar = { path: '/images/friends/test.webp' };
    await route.fulfill({ json: { friend, avatar_generation: [{ status: 'generated' }] } });
  });
  await page.route(/\/api\/friends\/[^/]+$/, async (route) => {
    const request = route.request();
    const oldName = decodeURIComponent(new URL(request.url()).pathname.split('/').at(-1)!);
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as { name: string; likely_base_area: string };
      const friend = payload.friends.find((profile) => profile.name === oldName)!;
      friend.name = body.name;
      friend.modified_at = '2026-08-28T03:04:05Z';
      friend.likely_base = { ...friend.likely_base, area: body.likely_base_area, status: 'manual', confidence_label: '人工' };
      payload.postcards.filter((card) => card.sender === oldName).forEach((card) => { card.sender = body.name; });
      await route.fulfill({ json: { friend } });
      return;
    }
    payload.friends = payload.friends.filter((profile) => profile.name !== oldName);
    payload.orphaned_sender_names.push(oldName);
    await route.fulfill({ json: { friend: { name: oldName, lifecycle: { status: 'deleted' } } } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '朋友足跡' }).click();
  let card = page.locator('.friend-card').filter({ has: page.getByRole('heading', { name: 'Alice', exact: true }) });
  await card.getByText('展開資料與明信片').click();
  await card.getByRole('button', { name: '編輯情報' }).click();
  let dialog = page.getByRole('dialog', { name: '編輯情報' });
  await dialog.getByRole('button', { name: '重新截圖' }).click();
  await expect(page.getByText('Mii 頭像已更新')).toBeVisible();
  expect(avatarCalls).toBe(1);
  await dialog.getByLabel('名稱').fill('Alice 新');
  await dialog.getByLabel('可能據點').fill('Boston, Massachusetts, United States（美國麻薩諸塞州波士頓）');
  await dialog.getByRole('button', { name: '保存情報' }).click();
  await expect(dialog).toBeHidden();

  card = page.locator('.friend-card').filter({ has: page.getByRole('heading', { name: 'Alice 新', exact: true }) });
  await expect(card).toContainText('可能據點 · Boston, Massachusetts, United States');
  await expect(card.locator('.friend-details')).toHaveAttribute('open', '');
  await card.getByRole('button', { name: '編輯情報' }).click();
  dialog = page.getByRole('dialog', { name: '編輯情報' });
  await dialog.getByRole('button', { name: '刪除', exact: true }).click();
  await dialog.getByRole('button', { name: '確認 soft delete' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Alice 新', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '明信片', exact: true }).click();
  const orphanCard = page.locator('.postcard-card').filter({ hasText: '寄件人：無主（原寄件人：Alice 新）' }).first();
  await expect(orphanCard).toBeVisible();
  expect(payload.postcards.filter((postcard) => postcard.sender === 'Alice 新').length).toBe(3);
});

test('friend merge moves cards into the chosen profile and removes only the source profile', async ({ page }) => {
  await page.unroute('**/api/archive');
  const payload = createArchiveFixture();
  await page.route('**/api/archive', async (route) => route.fulfill({ json: payload }));
  await page.route(/\/api\/friends\/[^/]+\/merge$/, async (route) => {
    const sourceName = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2)!);
    const { target_name: targetName } = route.request().postDataJSON() as { target_name: string };
    const source = payload.friends.find((profile) => profile.name === sourceName)!;
    const target = payload.friends.find((profile) => profile.name === targetName)!;
    payload.postcards.filter((card) => card.sender === sourceName).forEach((card) => { card.sender = targetName; });
    target.evidence_postcard_ids = [...target.evidence_postcard_ids, ...source.evidence_postcard_ids];
    target.modified_at = '2026-08-28T04:05:06Z';
    payload.friends = payload.friends.filter((profile) => profile.name !== sourceName);
    await route.fulfill({ json: { friend: target, merged_friend: source, avatar_generation: [] } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '朋友足跡' }).click();
  const bob = page.locator('.friend-card').filter({ has: page.getByRole('heading', { name: 'Bob', exact: true }) });
  await bob.getByText('展開資料與明信片').click();
  await bob.getByRole('button', { name: '編輯情報' }).click();
  const dialog = page.getByRole('dialog', { name: '編輯情報' });
  await dialog.getByRole('button', { name: '合併寄件者' }).click();
  await dialog.getByLabel('搜尋寄件者').fill('Carol');
  await dialog.locator('.friend-merge-list > button').click();
  await dialog.getByRole('button', { name: '確認合併' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Bob', exact: true })).toHaveCount(0);
  const carol = page.locator('.friend-card').filter({ has: page.getByRole('heading', { name: 'Carol', exact: true }) });
  await carol.getByText('展開資料與明信片').click();
  await expect(carol).toContainText('6 張／');
});

test('postcard arrows follow the full archive order or the selected friend order', async ({ page }) => {
  await page.goto('/');
  const archiveCards = page.locator('.postcard-card');
  const firstArchiveTitle = (await archiveCards.nth(0).locator('h3').innerText()).trim();
  const secondArchiveTitle = (await archiveCards.nth(1).locator('h3').innerText()).trim();
  await archiveCards.nth(0).locator('.image-button').click();
  const detail = page.locator('.detail-modal');
  const navigation = detail.locator('.postcard-context-navigation');
  await expect(detail.getByRole('heading', { name: firstArchiveTitle, exact: true })).toBeVisible();
  await expect(navigation).toContainText('目前明信片排序');
  await navigation.getByRole('button', { name: '下一張明信片' }).click();
  await expect(detail.getByRole('heading', { name: secondArchiveTitle, exact: true })).toBeVisible();
  expect(await detail.evaluate((element) => {
    const story = element.querySelector('.detail-story');
    const arrows = element.querySelector('.postcard-context-navigation');
    const location = element.querySelector('.location-map');
    return Boolean(story && arrows && location
      && (story.compareDocumentPosition(arrows) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (arrows.compareDocumentPosition(location) & Node.DOCUMENT_POSITION_FOLLOWING));
  })).toBe(true);
  await page.getByRole('button', { name: '關閉' }).click();

  await page.getByRole('button', { name: '朋友足跡' }).click();
  const friend = page.locator('.friend-card').filter({ has: page.getByRole('heading', { name: '柳柳', exact: true }) });
  await friend.getByText('展開資料與明信片').click();
  const friendCards = friend.locator('.timeline > button');
  const firstFriendTitle = (await friendCards.nth(0).locator('span').innerText()).trim();
  const secondFriendTitle = (await friendCards.nth(1).locator('span').innerText()).trim();
  await friendCards.nth(0).click();
  await expect(detail.getByRole('heading', { name: firstFriendTitle, exact: true })).toBeVisible();
  await expect(navigation).toContainText('寄件者 · 柳柳');
  await navigation.getByRole('button', { name: '下一張明信片' }).click();
  await expect(detail.getByRole('heading', { name: secondFriendTitle, exact: true })).toBeVisible();
});
