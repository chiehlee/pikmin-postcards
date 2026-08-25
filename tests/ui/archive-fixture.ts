import type { Page } from '@playwright/test';

export type ArchivePayload = {
  api_version: number;
  postcards: FixturePostcard[];
  friends: FixtureFriend[];
  totals: { active: number; deleted: number };
  capabilities: {
    management: boolean;
    ai_configured: boolean;
    provider: 'openai_api' | 'local_codex';
    model: string;
    reasoning_effort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  };
  jobs: Array<Record<string, unknown>>;
};

type FixturePostcard = Record<string, unknown> & {
  id: string;
  poi_name: string;
  sender: string | null;
  asset: Record<string, unknown>;
  research: Record<string, unknown> & {
    summary: string;
    images: Array<Record<string, unknown>>;
  };
};

type FixtureFriend = Record<string, unknown> & {
  name: string;
  evidence_postcard_ids: string[];
  likely_base: {
    area: string | null;
    status: string;
    confidence: string;
    confidence_label: string;
    reason: string;
  };
  avoid_send: { areas: string[]; reason: string };
};

const namedCards = [
  ['One Grantai Fontain', 'Our Lady of Carmel, Taipei'],
  ['CK124蒸汽火車特色郵筒', 'Zhongxin, Beitou District'],
  ['藤城清治美術館', 'Nasu, Yumoto'],
  ['金字塔2', 'Ankang, Xinyi District'],
  ['인공폭포', 'Seoul'],
  ['廟街牌坊', 'Jordan'],
] as const;

const friendNames = ['柳柳', '花花', '菎娜', 'Alice', 'Bob', 'Carol', 'Dae', 'Emi'];
const friendCounts = [6, 5, 3, 3, 3, 3, 3, 3];

export function createArchiveFixture(): ArchivePayload {
  let friendIndex = 0;
  let friendRemaining = friendCounts[0];
  const postcards = Array.from({ length: 65 }, (_, index) => {
    const sequence = index + 1;
    const named = namedCards[index];
    const sender = friendIndex < friendNames.length ? friendNames[friendIndex] : null;
    if (sender) {
      friendRemaining -= 1;
      if (friendRemaining === 0) {
        friendIndex += 1;
        friendRemaining = friendCounts[friendIndex] ?? 0;
      }
    }
    return postcard(sequence, named?.[0] ?? `合成測試明信片 ${String(sequence).padStart(2, '0')}`, named?.[1] ?? 'Test District', sender);
  });

  const friends = friendNames.map((name) => ({
    name,
    evidence_postcard_ids: postcards.filter((card) => card.sender === name).map((card) => card.id),
    likely_base: name === '菎娜'
      ? { area: '臺北市北投區', status: 'early-signal', confidence: 'medium', confidence_label: '中', reason: '合成測試的保守據點訊號。' }
      : { area: null, status: 'needs-review', confidence: 'low', confidence_label: '低', reason: '合成測試資料尚不足以推定據點。' },
    avoid_send: { areas: [], reason: '無正式建議' },
  }));

  return {
    api_version: 1,
    postcards,
    friends,
    totals: { active: postcards.length, deleted: 0 },
    capabilities: {
      management: true,
      ai_configured: true,
      provider: 'openai_api',
      model: 'test-model',
      reasoning_effort: 'high',
    },
    jobs: [],
  };
}

export async function mockArchive(
  page: Page,
  transform: (payload: ArchivePayload) => ArchivePayload = (payload) => payload,
) {
  await page.route('**/api/archive', async (route) => {
    await route.fulfill({ json: transform(createArchiveFixture()) });
  });
}

function postcard(sequence: number, poiName: string, rawLocation: string, sender: string | null): FixturePostcard {
  const special = specialLocation(poiName);
  const id = poiName === '金字塔2' ? 'pc-0020' : `pc-ui-${String(sequence).padStart(3, '0')}`;
  const date = `2026-${String((sequence % 12) + 1).padStart(2, '0')}-${String((sequence % 27) + 1).padStart(2, '0')}`;
  const archivedAt = `2026-08-24T12:${String(sequence % 60).padStart(2, '0')}:${String(sequence % 60).padStart(2, '0')}.000Z`;
  const detailBody = Array.from({ length: poiName === 'One Grantai Fontain' || poiName.startsWith('CK124') ? 45 : 4 }, (_, paragraph) => (
    `${poiName} 的合成長版研究第 ${paragraph + 1} 段。這些內容只用於驗證捲動、排版、來源與管理功能，不對應任何真實收藏。`
  )).join('\n\n');
  return {
    id,
    poi_name: poiName,
    found_date: date,
    received_at: null,
    archived_on: '2026-08-24',
    archived_at: archivedAt,
    sender,
    acquisition: sender
      ? { type: 'received', sender_status: 'confirmed', confidence: 'high', evidence: ['sender-visible'] }
      : { type: 'self_found', sender_status: 'not_applicable', confidence: 'high', evidence: ['send-to-friend-button-visible'] },
    location: {
      raw: rawLocation,
      display: special.display,
      endonym: special.endonym,
      zh_tw: special.zhTw,
      language: special.language,
      name_status: 'researched',
      name_confidence: 'high',
      country: special.country,
      country_code: special.countryCode,
      country_endonym: special.countryEndonym,
      address_local: special.address,
      precision: special.precision,
      latitude: 25.0 + sequence / 1000,
      longitude: 121.5 + sequence / 1000,
      geocode: {
        status: 'resolved', provider: 'manual', query: special.address, matched_label: special.address,
        precision: special.precision, confidence: 'high', resolved_at: archivedAt,
        attribution: 'Synthetic Playwright fixture', error: null,
      },
    },
    asset: { path: '/og.png', sha256: String(sequence).padStart(64, '0'), bytes: 1024 },
    curation: { rating: 2.5 + (sequence % 6) / 2, recommendation: '保留', status: sequence === 8 ? 'candidate' : 'keep', tags: ['synthetic-ui'] },
    research: {
      status: 'synthetic_fixture', confidence: 'high', confidence_label: '高',
      summary: `${poiName} 的合成研究摘要，用來驗證收藏 UI。`,
      sources: ['https://example.com/synthetic-source'],
      confirmed_facts: ['這是合成的 UI 測試資料。'],
      inferences: ['只驗證介面，不代表真實研究。'],
      unresolved_questions: ['無真實世界問題。'],
      images: [],
      detail: { status: 'structured_preserved', body: detailBody, source_path: `research/raw/fixtures/${id}.md`, preservation_note: null },
    },
    provenance: [{ source_session: 'playwright-synthetic', source_sequence: sequence, source_screenshot: `${id}.png` }],
    related_postcards: sequence === 1 ? [{ id: 'pc-ui-002', relationship: 'same-test-series', note: '合成測試關聯。' }] : [],
  };
}

function specialLocation(poiName: string) {
  if (poiName === '藤城清治美術館') return location('栃木県那須郡那須町湯本203', '日本', 'JP', '日本', 'ja', 'full_address');
  if (poiName === '金字塔2') return location('臺北市信義區松仁路89號', '臺灣', 'TW', '臺灣', 'zh-Hant-TW', 'full_address');
  if (poiName === '인공폭포') return { ...location('서울특별시, 대한민국（韓國首爾特別市）', '韓國', 'KR', '대한민국', 'ko', 'city'), endonym: '서울특별시', zhTw: '韓國首爾特別市', address: '서울특별시' };
  if (poiName === '廟街牌坊') return location('佐敦, 香港', '香港', 'HK', '香港', 'zh-Hant-HK', 'district');
  return location('臺北市北投區測試路1號', '臺灣', 'TW', '臺灣', 'zh-Hant-TW', 'full_address');
}

function location(display: string, country: string, countryCode: string, countryEndonym: string, language: string, precision: string) {
  return { display, endonym: display, zhTw: null, language, country, countryCode, countryEndonym, address: display, precision };
}
