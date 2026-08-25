import { expect, type Page, test } from '@playwright/test';
import { createArchiveFixture, mockArchive } from './archive-fixture';

const postcardName = 'One Grantai Fontain';
const tallPostcardName = 'CK124蒸汽火車特色郵筒';

test.beforeEach(async ({ page }) => mockArchive(page));

async function openPostcard(page: Page, name = postcardName, postcardId: string | null = null) {
  await page.goto('/');
  await page.getByPlaceholder('名稱、地點、故事或標籤').fill(name);
  const card = postcardId
    ? page.locator(`.postcard-card[data-postcard-id="${postcardId}"]`)
    : page.locator('.postcard-card').filter({ hasText: name });
  await expect(card).toHaveCount(1);
  await card.getByRole('button', { name: `查看 ${name}` }).click();
  const dialog = page.locator('.detail-modal');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('homepage uses a functional Pikmin postcard title', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /Pikmin 明信片\s*收藏研究庫/ })).toBeVisible();
  await expect(page).toHaveTitle('Pikmin 明信片收藏研究庫');
});

test('archive controls distinguish both dates and restore every dropdown default without a notification', async ({ page }) => {
  await page.goto('/');
  const senderFilter = page.locator('.filters label').filter({ hasText: /^來源／寄件人/ }).locator('select');
  const countryFilter = page.locator('.filters label').filter({ hasText: /^國家／地區/ }).locator('select');
  const statusFilter = page.locator('.filters label').filter({ hasText: /^收藏判斷/ }).locator('select');
  const sortField = page.getByLabel('排序', { exact: true });
  const sortDirection = page.getByLabel('排序方向');
  const restoreDefaults = page.getByRole('button', { name: '恢復預設：來源、國家、收藏判斷與排序' });

  await expect(sortField.locator('option')).toHaveText([
    '評分',
    '發現日期',
    '加入系統時間',
    '距離',
  ]);
  await expect(sortField).toHaveValue('archived_on');
  await expect(sortDirection).toHaveValue('desc');
  await expect(senderFilter).toHaveValue('all');
  await expect(countryFilter).toHaveValue('all');
  await expect(statusFilter).toHaveValue('all');
  await expect(restoreDefaults).toBeEnabled();
  await restoreDefaults.click();
  await expect(page.locator('.management-notice')).toHaveCount(0);
  await expect(page.locator('.postcard-card time').first()).toContainText('加入系統');
  await expect(page.locator('.postcard-card time').first()).toContainText(/\d{2}:\d{2}:\d{2}/);

  await sortField.selectOption('found_date');
  await sortDirection.selectOption('asc');
  const foundDates = await page.locator('.postcard-card time[datetime]').evaluateAll(
    (elements) => elements.map((element) => element.getAttribute('datetime') ?? ''),
  );
  expect(foundDates).toEqual([...foundDates].sort());
  await expect(page.locator('.postcard-card time').first()).toContainText('發現');

  await sortField.selectOption('archived_on');
  await expect(page.locator('.postcard-card time').first()).toContainText('加入系統');
  await expect(page.locator('.postcard-card time').first()).toHaveAttribute('datetime', /T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);

  await senderFilter.selectOption('self-found');
  await countryFilter.selectOption({ label: '日本' });
  await statusFilter.selectOption('candidate');
  await sortDirection.selectOption('asc');
  await restoreDefaults.click();
  await expect(senderFilter).toHaveValue('all');
  await expect(countryFilter).toHaveValue('all');
  await expect(statusFilter).toHaveValue('all');
  await expect(sortField).toHaveValue('archived_on');
  await expect(sortDirection).toHaveValue('desc');
  await expect(restoreDefaults).toBeEnabled();
  await expect(page.locator('.management-notice')).toHaveCount(0);
});

test('researched locations use the local script while preserving the game text', async ({ page }) => {
  const nasuDialog = await openPostcard(page, '藤城清治美術館');
  const nasuLocation = nasuDialog.locator('.detail-location');
  await expect(nasuLocation).toContainText('栃木県那須郡那須町湯本203');
  await expect(nasuLocation.locator('small')).toHaveText('遊戲顯示：Nasu, Yumoto');
  await page.keyboard.press('Escape');

  const taipeiDialog = await openPostcard(page, '金字塔2', 'pc-0020');
  const taipeiLocation = taipeiDialog.locator('.detail-location');
  await expect(taipeiLocation).toContainText('臺北市信義區松仁路89號');
  await expect(taipeiLocation.locator('small')).toHaveText('遊戲顯示：Ankang, Xinyi District');
  await expect(taipeiDialog.locator('.location-map-heading')).toContainText('臺北市信義區松仁路89號');
  await expect(taipeiDialog.locator('.location-map-precision')).toContainText('地址精度：完整地址');
  await page.keyboard.press('Escape');

  const seoulDialog = await openPostcard(page, '인공폭포');
  const seoulLocation = seoulDialog.locator('.detail-location');
  await expect(seoulLocation).toContainText('서울특별시, 대한민국（韓國首爾特別市）');
  await expect(seoulLocation.locator('small')).toHaveText('遊戲顯示：Seoul');
  await expect(seoulDialog.locator('.location-map-precision')).toContainText('地址精度：城市');
  await page.keyboard.press('Escape');

  const jordanDialog = await openPostcard(page, '廟街牌坊');
  const jordanLocation = jordanDialog.locator('.detail-location');
  await expect(jordanLocation).toContainText('佐敦, 香港');
  await expect(jordanLocation).not.toContainText('佐敦，香港');
  await expect(jordanLocation.locator('small')).toHaveText('遊戲顯示：Jordan');
});

test('distance sorting uses a manual origin and every active postcard persisted coordinate', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('排序', { exact: true }).selectOption('distance');
  const distanceTools = page.locator('.distance-sort-tools');
  await expect(distanceTools).toBeVisible();
  await expect(distanceTools).toContainText('65 / 65 張可計算');
  await distanceTools.getByLabel('參考緯度').fill('25.033000');
  await distanceTools.getByLabel('參考經度').fill('121.565000');
  await distanceTools.getByRole('button', { name: '套用座標' }).click();
  await expect(distanceTools).toContainText('目前基準：25.033000, 121.565000');

  const ascending = await page.locator('.postcard-card .distance').evaluateAll((elements) => (
    elements.map((element) => Number.parseFloat(element.textContent?.match(/[\d.]+/)?.[0] ?? 'NaN'))
  ));
  expect(ascending).toHaveLength(60);
  expect(ascending.every(Number.isFinite)).toBe(true);
  expect(ascending).toEqual([...ascending].sort((left, right) => left - right));
  await expect(page.getByText('尚無可計算座標')).toHaveCount(0);

  await page.getByLabel('排序方向').selectOption('desc');
  const descending = await page.locator('.postcard-card .distance').evaluateAll((elements) => (
    elements.map((element) => Number.parseFloat(element.textContent?.match(/[\d.]+/)?.[0] ?? 'NaN'))
  ));
  expect(descending).toEqual([...descending].sort((left, right) => right - left));
});

test('long-form research uses an independently scrollable modal and restores focus', async ({ page }) => {
  const postcardDialog = await openPostcard(page);
  const body = page.locator('body');
  const trigger = postcardDialog.getByRole('button', { name: '展開長版研究' });

  await expect(body).toHaveClass(/modal-open/);
  await trigger.click();

  const researchDialog = page.locator('.research-modal');
  const researchScroll = researchDialog.locator('.research-modal-scroll');
  const researchHeader = researchDialog.locator('.research-modal-header');
  const closeButton = researchDialog.getByRole('button', { name: '關閉長版研究' });
  await expect(researchDialog).toBeVisible();
  await expect(closeButton).toBeFocused();
  expect(await postcardDialog.evaluate(
    (element) => element instanceof HTMLElement && element.inert,
  )).toBe(true);

  const dimensions = await researchScroll.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);

  const headerBefore = await researchHeader.boundingBox();
  await researchScroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => researchScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const headerAfter = await researchHeader.boundingBox();
  expect(headerBefore).not.toBeNull();
  expect(headerAfter).not.toBeNull();
  expect(Math.abs(headerAfter!.y - headerBefore!.y)).toBeLessThan(1);

  await page.keyboard.press('Shift+Tab');
  await expect(researchDialog.getByRole('link').last()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(closeButton).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(researchDialog).toBeHidden();
  await expect(postcardDialog).toBeVisible();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.locator('.research-modal-backdrop').click({ position: { x: 4, y: 4 } });
  await expect(researchDialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(postcardDialog).toBeHidden();
  await expect(body).not.toHaveClass(/modal-open/);
});

test('postcard details scroll independently while the image panel stays fixed', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The split-pane layout only applies above the mobile breakpoint.');
  const postcardDialog = await openPostcard(page, tallPostcardName);
  const copy = postcardDialog.locator('.modal-copy');
  const imagePanel = postcardDialog.locator('.modal-image-panel');

  const dimensions = await copy.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);

  const mapFollowsResearchNote = await postcardDialog.evaluate((element) => {
    const researchNote = element.querySelector('.detail-story');
    const map = element.querySelector('.location-map');
    return Boolean(
      researchNote
      && map
      && researchNote.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
  expect(mapFollowsResearchNote).toBe(true);

  const imageBefore = await imagePanel.boundingBox();
  const initialScrollTop = await copy.evaluate((element) => element.scrollTop);
  await copy.hover();
  await page.mouse.wheel(0, 700);
  await expect.poll(() => copy.evaluate((element) => element.scrollTop)).toBeGreaterThan(initialScrollTop);
  const imageAfter = await imagePanel.boundingBox();

  expect(imageBefore).not.toBeNull();
  expect(imageAfter).not.toBeNull();
  expect(Math.abs(imageAfter!.x - imageBefore!.x)).toBeLessThan(1);
  expect(Math.abs(imageAfter!.y - imageBefore!.y)).toBeLessThan(1);
  expect(Math.abs(imageAfter!.width - imageBefore!.width)).toBeLessThan(1);
  expect(Math.abs(imageAfter!.height - imageBefore!.height)).toBeLessThan(1);
});

test('Google Map stays lazy, then loads a working keyless embed', async ({ page }) => {
  const postcardDialog = await openPostcard(page);
  const map = postcardDialog.locator('.location-map');
  const management = postcardDialog.locator('.postcard-management');
  const iframe = map.getByTitle(`${postcardName} 的 Google Maps 研究定位`);

  await expect(map).toBeVisible();
  await expect(management).toBeVisible();
  expect(await map.evaluate((element, managementElement) => Boolean(
    element.compareDocumentPosition(managementElement as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
  ), await management.elementHandle())).toBe(true);
  await expect(iframe).toHaveCount(0);

  const googleRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.hostname === 'www.google.com'
      && url.pathname === '/maps'
      && url.searchParams.get('output') === 'embed';
  });
  await map.getByRole('button', { name: '載入 Google Map' }).click();
  const request = await googleRequest;

  await expect(iframe).toBeVisible();
  const source = new URL(await iframe.getAttribute('src') ?? '');
  expect(source.hostname).toBe('www.google.com');
  expect(source.pathname).toBe('/maps');
  expect(source.searchParams.get('output')).toBe('embed');
  expect(source.searchParams.has('key')).toBe(false);
  expect(source.searchParams.get('q')).toContain(postcardName);
  expect(source.searchParams.get('q')).not.toMatch(/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/);
  expect(request.url()).not.toContain('key=');
  await expect.poll(
    () => page.frames().some((frame) => frame.url().includes('google.com/maps/embed')),
    { timeout: 15_000 },
  ).toBe(true);
});

test('locally preserved research images appear below the map and above management', async ({ page }) => {
  await page.route('**/api/archive', async (route) => {
    const payload = createArchiveFixture();
    const postcard = payload.postcards.find((item) => item.poi_name === postcardName)!;
    postcard.research.images = [
      {
        path: '/og.png',
        sha256: 'a'.repeat(64),
        bytes: 123,
        media_type: 'image/png',
        source_page_url: 'https://example.com/story-one',
        source_page_url_sha256: 'b'.repeat(64),
        source_image_url: 'https://images.example.com/story-one.png',
        source_image_url_sha256: 'c'.repeat(64),
        caption: '噴泉入口的建築外觀',
        alt: 'One Grantai Fontain 入口與噴泉',
        credit: 'Example Archive',
      },
      {
        path: '/og.png',
        sha256: 'd'.repeat(64),
        bytes: 456,
        media_type: 'image/png',
        source_page_url: 'https://example.org/story-two',
        source_page_url_sha256: 'e'.repeat(64),
        source_image_url: 'https://images.example.org/story-two.png',
        source_image_url_sha256: 'f'.repeat(64),
        caption: '場館周邊的空間線索',
        alt: '場館周邊環境',
        credit: null,
      },
    ];
    await route.fulfill({ json: payload });
  });

  const postcardDialog = await openPostcard(page);
  const gallery = postcardDialog.locator('.research-image-gallery');
  await expect(gallery).toBeVisible();
  await expect(gallery.getByRole('heading', { name: '故事參考圖片' })).toBeVisible();
  await expect(gallery.locator('figure')).toHaveCount(2);
  await expect(gallery.locator('img').first()).toHaveAttribute('src', '/og.png');
  await expect(gallery.locator('img').first()).toHaveAttribute('loading', 'lazy');
  await expect(gallery.locator('img').first()).toHaveAttribute('alt', 'One Grantai Fontain 入口與噴泉');
  await expect(gallery.getByText('圖片：Example Archive')).toBeVisible();
  await expect(gallery.getByRole('link', { name: '查看圖片來源 ↗' }).first()).toHaveAttribute('href', 'https://example.com/story-one');

  const order = await postcardDialog.evaluate((element) => {
    const mapElement = element.querySelector('.location-map');
    const galleryElement = element.querySelector('.research-image-gallery');
    const managementElement = element.querySelector('.postcard-management');
    return {
      mapBeforeGallery: Boolean(mapElement && galleryElement && mapElement.compareDocumentPosition(galleryElement) & Node.DOCUMENT_POSITION_FOLLOWING),
      galleryBeforeManagement: Boolean(galleryElement && managementElement && galleryElement.compareDocumentPosition(managementElement) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
  expect(order).toEqual({ mapBeforeGallery: true, galleryBeforeManagement: true });
});
