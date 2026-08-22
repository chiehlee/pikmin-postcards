'use client';
/* eslint-disable @next/next/no-img-element -- originals are intentionally served without transformation */

import { useEffect, useMemo, useState } from 'react';
import archive from '../data/postcards.json';
import friendArchive from '../data/friends.json';

type Status = 'keep' | 'representative' | 'candidate' | 'delete' | 'unreviewed';
type AcquisitionType = 'self_found' | 'received' | 'unknown';

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
    country: string | null;
    country_code: string | null;
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
  };
  related_postcards?: {
    id: string;
    relationship: 'same-metadata-different-image' | 'same-poi-name-variant';
  }[];
};

const postcards = archive.postcards as Postcard[];

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

export default function Home() {
  const [view, setView] = useState<'archive' | 'friends'>('archive');
  const [query, setQuery] = useState('');
  const [senderFilter, setSenderFilter] = useState('all');
  const [country, setCountry] = useState('all');
  const [status, setStatus] = useState<'all' | Status>('all');
  const [sort, setSort] = useState<'rating' | 'date'>('rating');
  const [active, setActive] = useState<Postcard | null>(null);

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
    return postcards
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
          postcard.research.summary,
          acquisitionLabel(postcard),
          ...postcard.curation.tags,
        ]
          .join(' ')
          .toLocaleLowerCase('zh-Hant')
          .includes(normalizedQuery);
      })
      .sort((a, b) =>
        sort === 'rating'
          ? (b.curation.rating ?? -1) - (a.curation.rating ?? -1) || (b.found_date ?? '').localeCompare(a.found_date ?? '')
          : (b.found_date ?? '').localeCompare(a.found_date ?? '') || (b.curation.rating ?? -1) - (a.curation.rating ?? -1),
      );
  }, [country, query, senderFilter, sort, status]);

  const friendGroups = useMemo(() => {
    return friendProfiles.map((profile) => ({
      name: profile.name,
      cards: postcards
        .filter((postcard) => profile.evidence_postcard_ids.includes(postcard.id))
        .sort((a, b) => (a.found_date ?? '').localeCompare(b.found_date ?? '')),
      signal: profile.likely_base.area ? `${profile.likely_base.area}・早期訊號` : '尚未判定',
      confidence: profile.likely_base.confidence_label,
      note: profile.likely_base.reason,
      avoid: profile.avoid_send.areas.length ? profile.avoid_send.areas.join('、') : '無正式建議',
    }));
  }, []);

  useEffect(() => {
    if (!active) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActive(null);
    };
    document.body.classList.add('modal-open');
    window.addEventListener('keydown', close);
    return () => {
      document.body.classList.remove('modal-open');
      window.removeEventListener('keydown', close);
    };
  }, [active]);

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
          <h1>把一張明信片，<br />讀成一個地方的故事。</h1>
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
        <section className="content-section" aria-labelledby="archive-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ARCHIVE</p>
              <h2 id="archive-title">收藏檔案</h2>
            </div>
            <p>顯示 {filtered.length} / {postcards.length} 張</p>
          </div>

          <div className="filters">
            <label className="search-box">
              <span>搜尋</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="名稱、地點、故事或標籤"
              />
            </label>
            <label>
              <span>來源／寄件人</span>
              <select value={senderFilter} onChange={(event) => setSenderFilter(event.target.value)}>
                <option value="all">全部</option>
                <option value="self-found">自己發現</option>
                {senders.map((name) => <option key={name} value={`sender:${name}`}>{name}</option>)}
                <option value="received-unknown">朋友寄來・寄件人未知</option>
                <option value="origin-unknown">來源待確認</option>
              </select>
            </label>
            <label>
              <span>國家／地區</span>
              <select value={country} onChange={(event) => setCountry(event.target.value)}>
                <option value="all">全部</option>
                {countries.map((name) => <option key={name}>{name}</option>)}
              </select>
            </label>
            <label>
              <span>收藏判斷</span>
              <select value={status} onChange={(event) => setStatus(event.target.value as 'all' | Status)}>
                <option value="all">全部</option>
                {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              <span>排序</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as 'rating' | 'date')}>
                <option value="rating">評分優先</option>
                <option value="date">日期優先</option>
              </select>
            </label>
          </div>

          {filtered.length ? (
            <div className="postcard-grid">
              {filtered.map((postcard) => (
                <article className="postcard-card" key={postcard.id}>
                  <button className="image-button" onClick={() => setActive(postcard)} aria-label={`查看 ${postcard.poi_name}`}>
                    <img src={postcard.asset.path} alt={`${postcard.poi_name} 原始遊戲截圖`} loading="lazy" decoding="async" />
                    <span className="rating">{postcard.curation.rating == null ? '未評分' : <>{postcard.curation.rating.toFixed(1)} <b>★</b></>}</span>
                    <span className="open-hint">查看檔案 ↗</span>
                  </button>
                  <div className="card-body">
                    <div className="card-kicker">
                      <span className={`status status-${postcard.curation.status}`}>{statusLabels[postcard.curation.status]}</span>
                      <time dateTime={postcard.found_date ?? undefined}>{compactDate(postcard.found_date)}</time>
                    </div>
                    <h3><button onClick={() => setActive(postcard)}>{postcard.poi_name}</button></h3>
                    <p className="place">{postcard.location.display}</p>
                    <p className="sender">{senderLine(postcard)}</p>
                    <p className="summary">{postcard.research.summary}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <strong>沒有符合條件的明信片</strong>
              <button onClick={() => { setQuery(''); setSenderFilter('all'); setCountry('all'); setStatus('all'); }}>清除篩選</button>
            </div>
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
                  <div className="avatar">{friend.name.slice(0, 1)}</div>
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
                    <button key={postcard.id} onClick={() => setActive(postcard)}>
                      <time>{postcard.found_date ? postcard.found_date.slice(5).replace('-', '/') : '日期？'}</time>
                      <span>{postcard.poi_name}</span>
                      <small>{postcard.location.display}</small>
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
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setActive(null); }}>
          <section className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title">
            <button className="modal-close" onClick={() => setActive(null)} aria-label="關閉">×</button>
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
              <p className="detail-location">{active.location.display}<small>遊戲顯示：{active.location.raw}</small></p>
              <div className="detail-facts">
                <div><span>見つけた日</span><strong>{active.found_date ?? '未確認'}</strong></div>
                <div><span>來源／寄件人</span><strong>{acquisitionLabel(active)}</strong></div>
                <div><span>收藏評分</span><strong>{active.curation.rating == null ? '未評分' : `${active.curation.rating.toFixed(1)} / 5`}</strong></div>
                <div><span>建議</span><strong>{active.curation.recommendation ?? '尚未整理'}</strong></div>
              </div>
              <div className="detail-story">
                <p className="eyebrow">RESEARCH NOTE</p>
                <p>{active.research.summary}</p>
              </div>
              <div className="tag-list">{active.curation.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
              {!!active.related_postcards?.length && (
                <div className="related-list">
                  <p className="eyebrow">RELATED SCREENSHOTS</p>
                  {active.related_postcards.map((relation) => {
                    const related = postcards.find((postcard) => postcard.id === relation.id);
                    if (!related) return null;
                    return (
                      <button key={`${relation.id}-${relation.relationship}`} onClick={() => setActive(related)}>
                        <img src={related.asset.path} alt="" />
                        <span>
                          <strong>{related.poi_name}</strong>
                          <small>{relation.relationship === 'same-poi-name-variant' ? '同一 POI 的名稱變體' : '相同 metadata 的另一張原始截圖'}</small>
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
      )}
    </main>
  );
}
