import { expect, type Page, test } from '@playwright/test';

const postcardName = 'One Grantai Fontain';
const tallPostcardName = 'CK124蒸汽火車特色郵筒';

async function openPostcard(page: Page, name = postcardName) {
  await page.goto('/');
  await page.getByPlaceholder('名稱、地點、故事或標籤').fill(name);
  const card = page.locator('.postcard-card').filter({ hasText: name });
  await expect(card).toHaveCount(1);
  await card.getByRole('button', { name: `查看 ${name}` }).click();
  const dialog = page.locator('.detail-modal');
  await expect(dialog).toBeVisible();
  return dialog;
}

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
  const iframe = map.getByTitle(`${postcardName} 的 Google Maps 研究定位`);

  await expect(map).toBeVisible();
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
  expect(request.url()).not.toContain('key=');
  await expect.poll(
    () => page.frames().some((frame) => frame.url().includes('google.com/maps/embed')),
    { timeout: 15_000 },
  ).toBe(true);
});
