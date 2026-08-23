'use client';
/* eslint-disable @next/next/no-img-element -- originals are intentionally served without transformation */

import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import archive from '../data/postcards.json';
import friendArchive from '../data/friends.json';
import { researchedLocationDisplay, researchedLocationQuery } from '../lib/location-names.mjs';
import { googleMapsEmbedUrl, googleMapsSearchUrl } from '../lib/map-links.mjs';
import {
  distanceKilometers,
  paginateRecords,
  postcardCoordinates,
  sortPostcards,
} from '../lib/postcard-sort.mjs';

const postcardsPerPage = 60;

type Status = 'keep' | 'representative' | 'candidate' | 'delete' | 'unreviewed';
type AcquisitionType = 'self_found' | 'received' | 'unknown';
type SortField = 'rating' | 'found_date' | 'archived_on' | 'distance';
type SortDirection = 'asc' | 'desc';
type DistanceOrigin = {
  latitude: number;
  longitude: number;
  source: 'device' | 'manual';
  accuracy?: number;
};
type MapTarget = {
  query: string;
  label: string;
  precision: 'coordinates' | 'researched_place_query';
};

type Postcard = {
  id: string;
  poi_name: string;
  found_date: string | null;
  received_at: string | null;
  archived_on: string;
  sender: string | null;
  acquisition: {
    type: AcquisitionType;
    sender_status: 'not_applicable' | 'confirmed' | 'unknown';
    confidence: 'high' | 'medium' | 'low';
    evidence: string[];
  };
  location: {
    raw: string;
    display: string;
    endonym: string;
    zh_tw: string | null;
    language: string;
    name_status: 'researched' | 'provisional';
    name_confidence: 'high' | 'medium' | 'low';
    country: string | null;
    country_code: string | null;
    country_endonym: string;
    address_local: string;
    precision: 'country' | 'region' | 'city' | 'district' | 'locality' | 'road' | 'full_address' | 'coordinates' | 'unknown';
    latitude?: number | null;
    longitude?: number | null;
  };
  asset: {
    path: string;
    sha256: string;
    bytes: number;
  };
  curation: {
    rating: number | null;
    recommendation: string | null;
    status: Status;
    tags: string[];
  };
  research: {
    confidence: string;
    confidence_label: string;
    summary: string;
    sources: string[];
    confirmed_facts?: string[];
    inferences?: string[];
    unresolved_questions?: string[];
    detail: {
      status: 'raw_preserved' | 'structured_preserved' | 'not_recovered';
      body: string | null;
      source_path: string;
      preservation_note: string | null;
    };
  };
  related_postcards?: {
    id: string;
    relationship: string;
    note?: string;
  }[];
};

const postcards = archive.postcards as Postcard[];
const researchedMapOverrides: Record<string, { query: string; label: string }> = {
  'pc-0020': {
    query: '壹號交易廣場, 台北市信義區松仁路89號',
    label: '壹號交易廣場前庭・臺北市信義區松仁路89號',
  },
};

const statusLabels: Record<Status, string> = {
  keep: '保留',
  representative: '代表性保留',
  candidate: '候補',
  delete: '刪除候選',
  unreviewed: '待整理',
};

const friendProfiles = friendArchive.profiles;

function compactDate(date: string | null) {
  if (!date) return '日期未確認';
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${date}T00:00:00+09:00`));
}

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function acquisitionLabel(postcard: Postcard) {
  if (postcard.acquisition.type === 'self_found') return '自己發現';
  if (postcard.sender) return `朋友寄來・${postcard.sender}`;
  if (postcard.acquisition.type === 'received') return '朋友寄來・寄件人未知';
  return '來源待確認';
}

function senderLine(postcard: Postcard) {
  if (postcard.acquisition.type === 'self_found') return '來源：自己發現';
  if (postcard.sender) return `寄件人：${postcard.sender}`;
  if (postcard.acquisition.type === 'received') return '寄件人：未知';
  return '來源：待確認';
}

function coordinateQuery(postcard: Postcard) {
  const coordinates = postcardCoordinates(postcard);
  return coordinates ? `${coordinates.latitude},${coordinates.longitude}` : null;
}

function mapTargetFor(postcard: Postcard): MapTarget | null {
  if (postcard.research.detail.status === 'not_recovered') return null;
  const coordinates = coordinateQuery(postcard);
  if (coordinates) {
    return { query: coordinates, label: coordinates, precision: 'coordinates' };
  }
  const override = researchedMapOverrides[postcard.id];
  if (override) return { ...override, precision: 'researched_place_query' };
  const researchedLocation = researchedLocationQuery(postcard.location);
  return {
    query: [postcard.poi_name, researchedLocation].filter(Boolean).join(', '),
    label: `${postcard.poi_name}・${researchedLocation}`,
    precision: 'researched_place_query',
  };
}

function relationshipLabel(relationship: string) {
  const labels: Record<string, string> = {
    'same-metadata-different-image': '同一張明信片的另一個截圖',
    'same-poi-name-variant': '同一 POI 的名稱變體',
    'same-place': '位於同一地點',
    'same-subject': '研究主題相互呼應',
    'same-series': '屬於同一系列',
    'historical-connection': '具有可說明的歷史關聯',
  };
  return labels[relationship] ?? relationship;
}

function trapDialogFocus(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export default function Home() {
  const [view, setView] = useState<'archive' | 'friends'>('archive');
  const [query, setQuery] = useState('');
  const [senderFilter, setSenderFilter] = useState('all');
  const [country, setCountry] = useState('all');
  const [status, setStatus] = useState<'all' | Status>('all');
  const [sortField, setSortField] = useState<SortField>('rating');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [distanceOrigin, setDistanceOrigin] = useState<DistanceOrigin | null>(null);
  const [locationFeedback, setLocationFeedback] = useState('尚未取得距離基準。');
  const [locating, setLocating] = useState(false);
  const [manualLatitude, setManualLatitude] = useState('');
  const [manualLongitude, setManualLongitude] = useState('');
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<Postcard | null>(null);
  const [mapLoadedFor, setMapLoadedFor] = useState<string | null>(null);
  const [researchOpen, setResearchOpen] = useState(false);
  const researchTriggerRef = useRef<HTMLButtonElement | null>(null);

  function openPostcard(postcard: Postcard) {
    setMapLoadedFor(null);
    setResearchOpen(false);
    setActive(postcard);
  }

  const closePostcard = useCallback(() => {
    setMapLoadedFor(null);
    setResearchOpen(false);
    setActive(null);
  }, []);

  const closeResearch = useCallback(() => {
    setResearchOpen(false);
    window.requestAnimationFrame(() => researchTriggerRef.current?.focus());
  }, []);

  function requestDeviceLocation() {
    if (typeof window === 'undefined' || !window.isSecureContext) {
      setLocationFeedback('目前是非安全的 LAN HTTP 連線，瀏覽器不允許讀取裝置位置；請改用 localhost／HTTPS，或輸入參考座標。');
      return;
    }
    if (!navigator.geolocation) {
      setLocationFeedback('這個瀏覽器不支援裝置定位；請輸入參考座標。');
      return;
    }
    setLocating(true);
    setLocationFeedback('正在取得裝置位置…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDistanceOrigin({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          source: 'device',
        });
        setPage(1);
        setLocationFeedback(`已使用裝置位置，定位精度約 ±${Math.round(position.coords.accuracy)} 公尺；位置只保存在目前頁面記憶體。`);
        setLocating(false);
      },
      (error) => {
        setLocationFeedback(error.code === error.PERMISSION_DENIED
          ? '定位權限未允許；可重新授權或輸入參考座標。'
          : '目前無法取得裝置位置；請稍後重試或輸入參考座標。');
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  function applyManualOrigin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manualLatitude.trim() || !manualLongitude.trim()) {
      setLocationFeedback('請同時輸入參考緯度與經度。');
      return;
    }
    const latitude = Number(manualLatitude);
    const longitude = Number(manualLongitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      setLocationFeedback('參考座標格式不正確；緯度需介於 -90～90，經度需介於 -180～180。');
      return;
    }
    setDistanceOrigin({ latitude, longitude, source: 'manual' });
    setPage(1);
    setLocationFeedback(`已使用手動參考座標 ${latitude}, ${longitude}；資料只保存在目前頁面記憶體。`);
  }

  function changeSortField(nextField: SortField) {
    setSortField(nextField);
    setSortDirection(nextField === 'distance' ? 'asc' : 'desc');
    setPage(1);
    if (nextField === 'distance' && !distanceOrigin) requestDeviceLocation();
  }

  function goToPage(nextPage: number) {
    setPage(nextPage);
    document.getElementById('archive')?.scrollIntoView({ block: 'start' });
  }

  const senders = useMemo(
    () => [...new Set(postcards.map((postcard) => postcard.sender).filter(Boolean))] as string[],
    [],
  );
  const countries = useMemo(
    () => [...new Set(postcards.map((postcard) => postcard.location.country ?? '未正規化'))],
    [],
  );

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-Hant');
    const matches = postcards
      .filter((postcard) => {
        if (senderFilter === 'all') return true;
        if (senderFilter === 'self-found') return postcard.acquisition.type === 'self_found';
        if (senderFilter === 'received-unknown') {
          return postcard.acquisition.type === 'received' && postcard.acquisition.sender_status === 'unknown';
        }
        if (senderFilter === 'origin-unknown') return postcard.acquisition.type === 'unknown';
        return senderFilter.startsWith('sender:') && postcard.sender === senderFilter.slice(7);
      })
      .filter((postcard) => country === 'all' || (postcard.location.country ?? '未正規化') === country)
      .filter((postcard) => status === 'all' || postcard.curation.status === status)
      .filter((postcard) => {
        if (!normalizedQuery) return true;
        return [
          postcard.poi_name,
          postcard.sender ?? '未確認',
          postcard.location.raw,
          postcard.location.display,
          postcard.location.endonym,
          postcard.location.zh_tw ?? '',
          postcard.research.summary,
          acquisitionLabel(postcard),
          ...postcard.curation.tags,
        ]
          .join(' ')
          .toLocaleLowerCase('zh-Hant')
          .includes(normalizedQuery);
      });
    return sortPostcards(matches, {
      field: sortField,
      direction: sortDirection,
      origin: distanceOrigin,
    });
  }, [country, distanceOrigin, query, senderFilter, sortDirection, sortField, status]);

  const friendGroups = useMemo(() => {
    return friendProfiles.map((profile) => ({
      name: profile.name,
      avatar: profile.avatar,
      cards: postcards
        .filter((postcard) => profile.evidence_postcard_ids.includes(postcard.id))
        .sort((a, b) => (a.found_date ?? '').localeCompare(b.found_date ?? '')),
      signal: profile.likely_base.area ? `${profile.likely_base.area}・早期訊號` : '尚未判定',
      confidence: profile.likely_base.confidence_label,
      note: profile.likely_base.reason,
      avoid: profile.avoid_send.areas.length ? profile.avoid_send.areas.join('、') : '無正式建議',
    }));
  }, []);
  const activeMapTarget = active ? mapTargetFor(active) : null;
  const activeMapIsLoaded = !!active && mapLoadedFor === active.id;
  const chronologicalSort = sortField === 'found_date' || sortField === 'archived_on';
  const filteredCoordinateCount = filtered.filter((postcard) => postcardCoordinates(postcard)).length;
  const pagination = paginateRecords(filtered, page, postcardsPerPage);

  useEffect(() => {
    if (!active) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (researchOpen) closeResearch();
      else closePostcard();
    };
    document.body.classList.add('modal-open');
    window.addEventListener('keydown', close);
    return () => {
      document.body.classList.remove('modal-open');
      window.removeEventListener('keydown', close);
    };
  }, [active, closePostcard, closeResearch, researchOpen]);

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="回到頁首">
          <span className="brand-mark">P</span>
          <span>
            <strong>Postcard Archive</strong>
            <small>Pikmin Bloom collection</small>
          </span>
        </a>
        <nav className="view-switch" aria-label="主要頁面">
          <button className={view === 'archive' ? 'active' : ''} onClick={() => setView('archive')}>
            明信片
          </button>
          <button className={view === 'friends' ? 'active' : ''} onClick={() => setView('friends')}>
            朋友足跡
          </button>
        </nav>
        <div className="archive-state"><span />本機資料庫</div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">COLLECTION 01 · 2026</p>
          <h1>Pikmin 明信片<br />收藏研究庫</h1>
          <p className="hero-lede">
            保存原始畫面、地方研究與收藏判斷；朋友據點只在證據足夠時才成立。
          </p>
        </div>
        <div className="hero-stats" aria-label="檔案統計">
          <div><strong>{postcards.length}</strong><span>明信片</span></div>
          <div><strong>{senders.length}</strong><span>已確認朋友</span></div>
          <div><strong>{countries.length}</strong><span>國家／地區</span></div>
          <div><strong>{postcards.filter((p) => p.research.confidence === 'high').length}</strong><span>高信心研究</span></div>
        </div>
      </section>

      <aside className="evidence-note">
        <span className="note-symbol">i</span>
        <p><strong>判讀原則</strong>「見つけた日」不是寄送日期；畫面有「フレンドに送る」代表自己發現。寄件人空白不再直接視為未知，只有收到明信片但身分無法確認時才標示「寄件人未知」。</p>
      </aside>

      {view === 'archive' ? (
        <section className="content-section" id="archive" aria-labelledby="archive-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ARCHIVE</p>
              <h2 id="archive-title">收藏檔案</h2>
            </div>
            <p>顯示 {pagination.start}–{pagination.end}，共 {filtered.length} / {postcards.length} 張</p>
          </div>

          <div className="filters">
            <label className="search-box">
              <span>搜尋</span>
              <input
                type="search"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setPage(1); }}
                placeholder="名稱、地點、故事或標籤"
              />
            </label>
            <label>
              <span>來源／寄件人</span>
              <select value={senderFilter} onChange={(event) => { setSenderFilter(event.target.value); setPage(1); }}>
                <option value="all">全部</option>
                <option value="self-found">自己發現</option>
                {senders.map((name) => <option key={name} value={`sender:${name}`}>{name}</option>)}
                <option value="received-unknown">朋友寄來・寄件人未知</option>
                <option value="origin-unknown">來源待確認</option>
              </select>
            </label>
            <label>
              <span>國家／地區</span>
              <select value={country} onChange={(event) => { setCountry(event.target.value); setPage(1); }}>
                <option value="all">全部</option>
                {countries.map((name) => <option key={name}>{name}</option>)}
              </select>
            </label>
            <label>
              <span>收藏判斷</span>
              <select value={status} onChange={(event) => { setStatus(event.target.value as 'all' | Status); setPage(1); }}>
                <option value="all">全部</option>
                {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              <span>排序依據</span>
              <select value={sortField} onChange={(event) => changeSortField(event.target.value as SortField)}>
                <option value="rating">評分優先</option>
                <option value="found_date">發現日期優先</option>
                <option value="archived_on">加入系統日期優先</option>
                <option value="distance">距離優先</option>
              </select>
            </label>
            <label>
              <span>排序方向</span>
              <select value={sortDirection} onChange={(event) => { setSortDirection(event.target.value as SortDirection); setPage(1); }}>
                <option value="asc">
                  {sortField === 'rating' ? '低 → 高' : chronologicalSort ? '舊 → 新' : '近 → 遠'}
                </option>
                <option value="desc">
                  {sortField === 'rating' ? '高 → 低' : chronologicalSort ? '新 → 舊' : '遠 → 近'}
                </option>
              </select>
            </label>
          </div>

          {sortField === 'distance' && (
            <section className="distance-sort-tools">
              <div className="distance-sort-copy">
                <strong>距離基準</strong>
                <span role="status" aria-live="polite">{locationFeedback}</span>
                <small>目前篩選結果有 {filteredCoordinateCount} / {filtered.length} 張具可計算座標；其餘固定排在最後。</small>
              </div>
              <button type="button" onClick={requestDeviceLocation} disabled={locating}>
                {locating ? '定位中…' : distanceOrigin?.source === 'device' ? '更新目前位置' : '使用目前位置'}
              </button>
              <form onSubmit={applyManualOrigin}>
                <label>
                  <span>緯度</span>
                  <input inputMode="decimal" value={manualLatitude} onChange={(event) => setManualLatitude(event.target.value)} placeholder="25.033" aria-label="參考緯度" />
                </label>
                <label>
                  <span>經度</span>
                  <input inputMode="decimal" value={manualLongitude} onChange={(event) => setManualLongitude(event.target.value)} placeholder="121.565" aria-label="參考經度" />
                </label>
                <button type="submit">套用座標</button>
              </form>
            </section>
          )}

          {filtered.length ? (
            <div className="postcard-grid">
              {pagination.items.map((postcard) => {
                const distance = distanceOrigin ? distanceKilometers(postcard, distanceOrigin) : null;
                const displayedDate = sortField === 'archived_on' ? postcard.archived_on : postcard.found_date;
                const displayedDateLabel = sortField === 'archived_on' ? '加入系統' : '發現';
                return (
                  <article className="postcard-card" key={postcard.id}>
                    <button className="image-button" onClick={() => openPostcard(postcard)} aria-label={`查看 ${postcard.poi_name}`}>
                      <img src={postcard.asset.path} alt={`${postcard.poi_name} 原始遊戲截圖`} loading="lazy" decoding="async" />
                      <span className="rating">{postcard.curation.rating == null ? '未評分' : <>{postcard.curation.rating.toFixed(1)} <b>★</b></>}</span>
                      <span className="open-hint">查看檔案 ↗</span>
                    </button>
                    <div className="card-body">
                      <div className="card-kicker">
                        <span className={`status status-${postcard.curation.status}`}>{statusLabels[postcard.curation.status]}</span>
                        <time dateTime={displayedDate ?? undefined}>{displayedDateLabel} · {compactDate(displayedDate)}</time>
                      </div>
                      <h3><button onClick={() => openPostcard(postcard)}>{postcard.poi_name}</button></h3>
                      <p className="place">{researchedLocationDisplay(postcard.location)}</p>
                      <p className="sender">{senderLine(postcard)}</p>
                      {sortField === 'distance' && (
                        <p className={`distance ${distance == null ? 'distance-missing' : ''}`}>
                          {distance == null ? '尚無可計算座標' : `距離 ${distance < 10 ? distance.toFixed(1) : Math.round(distance)} km`}
                        </p>
                      )}
                      <p className="summary">{postcard.research.summary}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <strong>沒有符合條件的明信片</strong>
              <button onClick={() => { setQuery(''); setSenderFilter('all'); setCountry('all'); setStatus('all'); setPage(1); }}>清除篩選</button>
            </div>
          )}

          {filtered.length > postcardsPerPage && (
            <nav className="pagination" aria-label="明信片分頁">
              <button type="button" onClick={() => goToPage(pagination.page - 1)} disabled={pagination.page === 1}>
                ← 上一頁
              </button>
              <div className="pagination-position">
                <span>第</span>
                <select
                  value={pagination.page}
                  onChange={(event) => goToPage(Number(event.target.value))}
                  aria-label="選擇頁數"
                >
                  {Array.from({ length: pagination.totalPages }, (_, index) => (
                    <option key={index + 1} value={index + 1}>{index + 1}</option>
                  ))}
                </select>
                <span>/ {pagination.totalPages} 頁</span>
                <small>{pagination.start}–{pagination.end} / {filtered.length} 張</small>
              </div>
              <button type="button" onClick={() => goToPage(pagination.page + 1)} disabled={pagination.page === pagination.totalPages}>
                下一頁 →
              </button>
            </nav>
          )}
        </section>
      ) : (
        <section className="content-section friend-section" aria-labelledby="friend-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">OBSERVATIONS</p>
              <h2 id="friend-title">朋友足跡</h2>
            </div>
            <p>只使用已確認寄件人的觀察</p>
          </div>
          <div className="friend-warning">
            目前資料仍少，所有據點判斷都是保守的早期訊號；單一地點或單日群集不視為生活據點。
          </div>
          <div className="friend-grid">
            {friendGroups.map((friend) => (
              <article className="friend-card" key={friend.name}>
                <div className="friend-topline">
                  <div className="avatar">
                    {friend.avatar?.path
                      ? <img src={friend.avatar.path} alt={`${friend.name} 的 Mii 頭像`} loading="lazy" decoding="async" />
                      : friend.name.slice(0, 1)}
                  </div>
                  <div><p>寄件人</p><h3>{friend.name}</h3></div>
                  <span className={`confidence confidence-${friend.confidence}`}>信心 {friend.confidence}</span>
                </div>
                <dl>
                  <div><dt>據點訊號</dt><dd>{friend.signal}</dd></div>
                  <div><dt>觀察數</dt><dd>{friend.cards.length} 張／{new Set(friend.cards.map((p) => p.found_date).filter(Boolean)).size} 個日期</dd></div>
                  <div><dt>避免寄送</dt><dd>{friend.avoid}</dd></div>
                </dl>
                <p className="friend-note">{friend.note}</p>
                <div className="timeline">
                  {friend.cards.map((postcard) => (
                    <button key={postcard.id} onClick={() => openPostcard(postcard)}>
                      <time>{postcard.found_date ? postcard.found_date.slice(5).replace('-', '/') : '日期？'}</time>
                      <span>{postcard.poi_name}</span>
                      <small>{researchedLocationDisplay(postcard.location)}</small>
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <footer>
        <p>Pikmin Postcard Archive</p>
        <span>原始截圖不可變更 · 研究與推論保留來源及不確定性</span>
      </footer>

      {active && (
        <>
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePostcard(); }}>
            <section
              className="detail-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="detail-title"
              inert={researchOpen || undefined}
            >
              <button className="modal-close" onClick={closePostcard} aria-label="關閉">×</button>
              <div className="modal-image-panel">
                <img src={active.asset.path} alt={`${active.poi_name} 原始遊戲截圖`} />
                <a href={active.asset.path} target="_blank" rel="noreferrer">開啟原始尺寸 ↗</a>
              </div>
              <div className="modal-copy">
              <div className="detail-meta">
                <span className={`status status-${active.curation.status}`}>{statusLabels[active.curation.status]}</span>
                <span>研究信心 {active.research.confidence_label}</span>
              </div>
              <h2 id="detail-title">{active.poi_name}</h2>
              <p className="detail-location">
                {researchedLocationDisplay(active.location)}
                <small>遊戲顯示：{active.location.raw}</small>
              </p>
              <div className="detail-facts">
                <div>
                  <span>見つけた日／加入系統</span>
                  <strong>{active.found_date ?? '未確認'}</strong>
                  <small>加入系統 · {active.archived_on}</small>
                </div>
                <div><span>來源／寄件人</span><strong>{acquisitionLabel(active)}</strong></div>
                <div><span>收藏評分</span><strong>{active.curation.rating == null ? '未評分' : `${active.curation.rating.toFixed(1)} / 5`}</strong></div>
                <div><span>建議</span><strong>{active.curation.recommendation ?? '尚未整理'}</strong></div>
              </div>
              <section className="detail-story">
                <button
                  ref={researchTriggerRef}
                  type="button"
                  className="research-summary-button"
                  aria-haspopup="dialog"
                  aria-expanded={researchOpen}
                  aria-controls="research-dialog"
                  onClick={() => setResearchOpen(true)}
                >
                  <span className="research-summary-head">
                    <span className="eyebrow">RESEARCH NOTE</span>
                    <span className="research-note-action">
                      {active.research.detail.status === 'not_recovered' ? '查看保存狀態' : '展開長版研究'}
                    </span>
                  </span>
                  <span className="research-summary-copy">{active.research.summary}</span>
                </button>
              </section>
              {activeMapTarget && (
                <section className="location-map" aria-labelledby="location-map-title">
                  <div className="location-map-heading">
                    <div>
                      <p className="eyebrow">RESEARCHED LOCATION</p>
                      <h3 id="location-map-title">研究定位</h3>
                      <p>{activeMapTarget.label}</p>
                    </div>
                    <a href={googleMapsSearchUrl(activeMapTarget.query)} target="_blank" rel="noreferrer">
                      Google Maps ↗
                    </a>
                  </div>
                  {activeMapIsLoaded ? (
                    <iframe
                      title={`${active.poi_name} 的 Google Maps 研究定位`}
                      src={googleMapsEmbedUrl(activeMapTarget.query)}
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                      allowFullScreen
                    />
                  ) : (
                    <div className="location-map-placeholder">
                      <span aria-hidden="true">⌖</span>
                      <strong>互動地圖尚未載入</strong>
                      <p>點擊後才會連線 Google Maps，避免首頁和明信片視窗產生不必要的地圖流量。</p>
                      <button onClick={() => setMapLoadedFor(active.id)}>載入 Google Map</button>
                    </div>
                  )}
                  <p className="location-map-precision">
                    {activeMapTarget.precision === 'coordinates'
                      ? '定位依據：明信片保存的座標'
                      : '定位依據：研究所得地點；marker 由 Google 依地名解析，尚非人工確認座標'}
                  </p>
                </section>
              )}
              <div className="tag-list">{active.curation.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
              {!!active.related_postcards?.length && (
                <div className="related-list">
                  <p className="eyebrow">RELATED POSTCARD</p>
                  {active.related_postcards.map((relation) => {
                    const related = postcards.find((postcard) => postcard.id === relation.id);
                    if (!related) return null;
                    return (
                      <button key={`${relation.id}-${relation.relationship}`} onClick={() => openPostcard(related)}>
                        <img src={related.asset.path} alt="" />
                        <span>
                          <strong>{related.poi_name}</strong>
                          <small>{relation.note ?? relationshipLabel(relation.relationship)}</small>
                        </span>
                        <b>→</b>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="source-list">
                <p className="eyebrow">PRESERVED SOURCES</p>
                {active.research.sources.map((source, index) => (
                  <a href={source} target="_blank" rel="noreferrer" key={source}>
                    <span>{String(index + 1).padStart(2, '0')}</span>{hostname(source)} ↗
                  </a>
                ))}
              </div>
              <p className="hash">SHA-256 · {active.asset.sha256}</p>
              </div>
            </section>
          </div>

          {researchOpen && (
            <div
              className="research-modal-backdrop"
              role="presentation"
              onMouseDown={(event) => { if (event.target === event.currentTarget) closeResearch(); }}
            >
              <section
                id="research-dialog"
                className="research-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="research-dialog-title"
                onKeyDown={trapDialogFocus}
              >
                <header className="research-modal-header">
                  <div>
                    <p className="eyebrow">LONG-FORM RESEARCH</p>
                    <h2 id="research-dialog-title">{active.poi_name}</h2>
                    <p>{researchedLocationDisplay(active.location)}</p>
                  </div>
                  <button type="button" className="research-modal-close" onClick={closeResearch} aria-label="關閉長版研究" autoFocus>×</button>
                </header>
                <div className="research-modal-scroll">
                  <div className="research-detail">
                    {active.research.detail.status === 'not_recovered' ? (
                      <section className="research-unavailable">
                        <p className="eyebrow">DETAIL NOT RECOVERED</p>
                        <h3>原始長版尚未復原</h3>
                        <p>{active.research.detail.preservation_note}</p>
                      </section>
                    ) : (
                      <>
                        <div className="research-detail-stats">
                          <span><small>研究信心</small>{active.research.confidence_label}</span>
                          <span><small>已確認事實</small>{active.research.confirmed_facts?.length ?? 0}</span>
                          <span><small>保存來源</small>{active.research.sources.length}</span>
                        </div>
                        <section>
                          <p className="eyebrow">PRESERVED DETAIL</p>
                          <h3>長版研究原文</h3>
                          <p>{active.research.detail.body}</p>
                        </section>
                        {!!active.research.confirmed_facts?.length && (
                          <section>
                            <p className="eyebrow">CONFIRMED FACTS</p>
                            <h3>已確認事實</h3>
                            <ul>{active.research.confirmed_facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
                          </section>
                        )}
                        {!!active.research.inferences?.length && (
                          <section>
                            <p className="eyebrow">INTERPRETATION</p>
                            <h3>推論與收藏解讀</h3>
                            <ul>{active.research.inferences.map((item) => <li key={item}>{item}</li>)}</ul>
                          </section>
                        )}
                        {!!active.research.unresolved_questions?.length && (
                          <section>
                            <p className="eyebrow">OPEN QUESTIONS</p>
                            <h3>仍待確認</h3>
                            <ul>{active.research.unresolved_questions.map((question) => <li key={question}>{question}</li>)}</ul>
                          </section>
                        )}
                      </>
                    )}
                    {!!active.research.sources.length && (
                      <section className="source-list research-source-list">
                        <p className="eyebrow">PRESERVED SOURCES</p>
                        <h3>研究來源</h3>
                        {active.research.sources.map((source, index) => (
                          <a href={source} target="_blank" rel="noreferrer" key={source}>
                            <span>{String(index + 1).padStart(2, '0')}</span>{hostname(source)} ↗
                          </a>
                        ))}
                      </section>
                    )}
                    <p className="research-provenance">研究保存來源 · {active.research.detail.source_path}</p>
                  </div>
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </main>
  );
}
