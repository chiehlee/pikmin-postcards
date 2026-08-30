'use client';
/* eslint-disable @next/next/no-img-element -- originals are intentionally served without transformation */

import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { researchedLocationDisplay, researchedLocationQuery } from '../lib/location-names.mjs';
import { googleMapsEmbedUrl, googleMapsSearchUrl } from '../lib/map-links.mjs';
import {
  distanceKilometers,
  modifiedTimestamp,
  paginateRecords,
  postcardCoordinates,
  sortPostcards,
} from '../lib/postcard-sort.mjs';

const postcardsPerPage = 60;
const friendPostcardsPreviewLimit = 5;
const defaultSortField: SortField = 'modified_at';
const defaultSortDirection: SortDirection = 'desc';

type Status = 'keep' | 'representative' | 'candidate' | 'delete' | 'unreviewed';
type AcquisitionType = 'self_found' | 'received' | 'unknown';
type SortField = 'rating' | 'found_date' | 'modified_at' | 'distance';
type SortDirection = 'asc' | 'desc';
type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
type AddWorkflow = 'metadata_only' | 'full_research';
type DistanceOrigin = {
  latitude: number;
  longitude: number;
  source: 'device' | 'manual' | 'postcard';
  accuracy?: number;
  label?: string;
};
type MapTarget = {
  query: string;
  label: string;
  precision: 'coordinates' | 'researched_place_query';
};
type ArchiveCapabilities = {
  management: boolean;
  ai_configured: boolean;
  provider: 'openai_api' | 'local_codex';
  model: string;
  reasoning_effort: ReasoningEffort;
};
type ManagementJob = {
  id: string;
  kind: 'add' | 'reresearch';
  workflow: AddWorkflow | 'full_research';
  batch_id: string | null;
  input_label: string | null;
  has_user_note?: boolean;
  status: 'queued' | 'in_progress' | 'applying' | 'completed' | 'failed' | 'cancelled';
  postcard_id: string | null;
  provider: 'openai_api' | 'local_codex';
  model: string;
  reasoning_effort: ReasoningEffort;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  preview_url?: string | null;
  result?: { exact_duplicate?: boolean; postcard_id?: string } | null;
};
type ManagementNotice = {
  id: number;
  kind: 'success' | 'error';
  title: string;
  message: string;
};
type ExactDuplicatePrompt = {
  input_label: string;
  postcard_id: string;
  poi_name: string;
  found_date: string | null;
  asset_path: string | null;
  sha256: string;
};

type PostcardNavigation = {
  source: 'archive' | 'friend';
  ids: string[];
  label: string;
};

type FriendProfile = {
  name: string;
  modified_at: string;
  evidence_postcard_ids: string[];
  likely_base: {
    area: string | null;
    status: string;
    confidence: string;
    confidence_label: string;
    reason: string;
  };
  avoid_send: { areas: string[]; reason: string };
  avatar?: {
    path: string;
  };
};

type Postcard = {
  id: string;
  poi_name: string;
  found_date: string | null;
  received_at: string | null;
  archived_on: string;
  archived_at?: string | null;
  modified_at?: string | null;
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
    geocode?: {
      status: 'resolved' | 'unresolved';
      provider: 'nominatim' | 'research_source' | 'manual' | 'visible_coordinates' | 'legacy' | null;
      query: string | null;
      matched_label: string | null;
      precision: Postcard['location']['precision'];
      confidence: 'high' | 'medium' | 'low';
      resolved_at: string | null;
      attribution: string | null;
      error?: string | null;
    };
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
    status: string;
    confidence: string;
    confidence_label: string;
    summary: string;
    sources: string[];
    confirmed_facts?: string[];
    inferences?: string[];
    unresolved_questions?: string[];
    images?: {
      path: string;
      sha256: string;
      bytes: number;
      media_type: string;
      source_page_url: string;
      source_page_url_sha256: string;
      source_image_url: string;
      source_image_url_sha256: string;
      caption: string;
      alt: string;
      credit: string | null;
    }[];
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
  lifecycle?: {
    status: 'active' | 'deleted';
    deleted_at: string | null;
    deleted_reason: string | null;
  };
  user_contributions?: {
    kind: 'reresearch_note';
    body: string;
    recorded_at: string;
    job_id: string;
  }[];
};

type GeocodeProvider = NonNullable<Postcard['location']['geocode']>['provider'];

const statusLabels: Record<Status, string> = {
  keep: '保留',
  representative: '代表性保留',
  candidate: '候補',
  delete: '刪除候選',
  unreviewed: '待整理',
};

function compactDate(date: string | null) {
  if (!date) return '日期未確認';
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${date}T00:00:00+09:00`));
}

function compactArchiveTime(postcard: Postcard) {
  if (!postcard.archived_at) return `${compactDate(postcard.archived_on)} · 時間未記錄`;
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(postcard.archived_at));
}

function compactModifiedTime(postcard: Postcard) {
  const timestamp = modifiedTimestamp(postcard);
  if (!timestamp) return '時間未記錄';
  if (!timestamp.includes('T')) return `${compactDate(timestamp)} · 時間未記錄`;
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(timestamp));
}

function liveAssetUrl(publicPath: string) {
  return publicPath.startsWith('/images/')
    ? `/api/assets?path=${encodeURIComponent(publicPath)}`
    : publicPath;
}

function recoverRuntimeAsset(event: SyntheticEvent<HTMLImageElement>, publicPath: string) {
  const fallback = liveAssetUrl(publicPath);
  if (event.currentTarget.getAttribute('src') !== fallback) event.currentTarget.src = fallback;
}

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function acquisitionLabel(postcard: Postcard, orphaned = false) {
  if (postcard.acquisition.type === 'self_found') return '自己發現';
  if (postcard.sender && orphaned) return `朋友寄來・無主（原寄件人：${postcard.sender}）`;
  if (postcard.sender) return `朋友寄來・${postcard.sender}`;
  if (postcard.acquisition.type === 'received') return '朋友寄來・寄件人未知';
  return '來源待確認';
}

function senderLine(postcard: Postcard, orphaned = false) {
  if (postcard.acquisition.type === 'self_found') return '來源：自己發現';
  if (postcard.sender && orphaned) return `寄件人：無主（原寄件人：${postcard.sender}）`;
  if (postcard.sender) return `寄件人：${postcard.sender}`;
  if (postcard.acquisition.type === 'received') return '寄件人：未知';
  return '來源：待確認';
}

function mapTargetFor(postcard: Postcard): MapTarget | null {
  if (postcard.research.detail.status === 'not_recovered' || postcard.research.status === 'metadata_only_pending_research') return null;
  const researchedLocation = researchedLocationQuery(postcard.location);
  return {
    query: [postcard.poi_name, researchedLocation].filter(Boolean).join(', '),
    label: `${postcard.poi_name}・${researchedLocation}`,
    precision: 'researched_place_query',
  };
}

function locationPrecisionLabel(precision: Postcard['location']['precision']) {
  const labels: Record<Postcard['location']['precision'], string> = {
    full_address: '完整地址',
    road: '路名',
    locality: '街區／町里',
    district: '行政區',
    city: '城市',
    region: '州／縣／區域',
    country: '國家',
    coordinates: '座標',
    unknown: '未確認',
  };
  return labels[precision];
}

function geocodeProviderLabel(provider: GeocodeProvider) {
  const labels = {
    nominatim: 'OpenStreetMap Nominatim',
    research_source: '研究來源',
    manual: '人工確認',
    visible_coordinates: '明信片畫面座標',
    legacy: '舊資料',
  } as const;
  return provider ? labels[provider] : '尚未解析';
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

function managementStatusLabel(status: ManagementJob['status'], workflow: ManagementJob['workflow'] = 'full_research') {
  if (workflow === 'metadata_only') {
    if (status === 'queued') return '等待辨識';
    if (status === 'in_progress') return 'AI 畫面辨識中';
    if (status === 'applying') return '建立收藏卡';
    if (status === 'completed') return '建檔完成';
    if (status === 'cancelled') return '已中止';
    return '建檔失敗';
  }
  if (status === 'queued') return '等待 AI';
  if (status === 'in_progress') return 'AI 研究中';
  if (status === 'applying') return '更新資料庫';
  if (status === 'completed') return '已完成';
  if (status === 'cancelled') return '已中止';
  return '失敗';
}

function isTerminalJob(job: ManagementJob) {
  return ['completed', 'failed', 'cancelled'].includes(job.status);
}

function managementKindLabel(job: ManagementJob) {
  if (job.kind === 'reresearch') return 'RE-RESEARCH';
  return job.workflow === 'metadata_only' ? 'QUICK INTAKE' : 'NEW + RESEARCH';
}

function elapsedLabel(job: ManagementJob, now: number) {
  const start = new Date(job.started_at ?? job.created_at).getTime();
  const end = job.completed_at ? new Date(job.completed_at).getTime() : now;
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':');
}

function aiProviderLabel(provider: ArchiveCapabilities['provider'] | ManagementJob['provider']) {
  return provider === 'local_codex' ? '本機 Codex' : 'OpenAI API';
}

function reasoningEffortLabel(effort: ReasoningEffort) {
  return ({ none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', max: 'Max' } as const)[effort];
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload as T;
}

export default function Home() {
  const [postcards, setPostcards] = useState<Postcard[]>([]);
  const [friendProfiles, setFriendProfiles] = useState<FriendProfile[]>([]);
  const [orphanedSenderNames, setOrphanedSenderNames] = useState<string[]>([]);
  const [archiveReady, setArchiveReady] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [view, setView] = useState<'archive' | 'friends'>('archive');
  const [query, setQuery] = useState('');
  const [senderFilter, setSenderFilter] = useState('all');
  const [country, setCountry] = useState('all');
  const [status, setStatus] = useState<'all' | Status>('all');
  const [sortField, setSortField] = useState<SortField>(defaultSortField);
  const [sortDirection, setSortDirection] = useState<SortDirection>(defaultSortDirection);
  const [distanceOrigin, setDistanceOrigin] = useState<DistanceOrigin | null>(null);
  const [locationFeedback, setLocationFeedback] = useState('請使用目前位置，或自行輸入緯度與經度。');
  const [locating, setLocating] = useState(false);
  const [manualLatitude, setManualLatitude] = useState('');
  const [manualLongitude, setManualLongitude] = useState('');
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<Postcard | null>(null);
  const [postcardNavigation, setPostcardNavigation] = useState<PostcardNavigation | null>(null);
  const [mapLoadedFor, setMapLoadedFor] = useState<string | null>(null);
  const [researchOpen, setResearchOpen] = useState(false);
  const [activeFriendName, setActiveFriendName] = useState<string | null>(null);
  const [editingFriendName, setEditingFriendName] = useState<string | null>(null);
  const [friendEditName, setFriendEditName] = useState('');
  const [friendEditBase, setFriendEditBase] = useState('');
  const [friendMergeOpen, setFriendMergeOpen] = useState(false);
  const [friendMergeQuery, setFriendMergeQuery] = useState('');
  const [friendMergeTarget, setFriendMergeTarget] = useState('');
  const [friendDeleteConfirm, setFriendDeleteConfirm] = useState(false);
  const [friendAction, setFriendAction] = useState<'save' | 'base' | 'merge' | 'avatar' | 'delete' | null>(null);
  const [expandedFriendNames, setExpandedFriendNames] = useState<Set<string>>(() => new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addWorkflow, setAddWorkflow] = useState<AddWorkflow>('metadata_only');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [sourceUrls, setSourceUrls] = useState('');
  const [addNote, setAddNote] = useState('');
  const [exactDuplicates, setExactDuplicates] = useState<ExactDuplicatePrompt[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reresearchOpen, setReresearchOpen] = useState(false);
  const [reresearchNote, setReresearchNote] = useState('');
  const [startingReresearch, setStartingReresearch] = useState(false);
  const [notice, setNotice] = useState<ManagementNotice | null>(null);
  const [capabilities, setCapabilities] = useState<ArchiveCapabilities>({
    management: true,
    ai_configured: false,
    provider: 'openai_api',
    model: 'gpt-5.6',
    reasoning_effort: 'high',
  });
  const [jobs, setJobs] = useState<ManagementJob[]>([]);
  const [cancellingJobIds, setCancellingJobIds] = useState<Set<string>>(() => new Set());
  const [clock, setClock] = useState(() => Date.now());
  const researchTriggerRef = useRef<HTMLButtonElement | null>(null);
  const reresearchNoteRef = useRef<HTMLTextAreaElement | null>(null);
  const friendMoreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const friendEditorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const notifiedBatchesRef = useRef<Set<string>>(new Set());

  const notify = useCallback((
    message: string,
    kind: ManagementNotice['kind'] = 'success',
    title = kind === 'success' ? '操作成功' : '發生錯誤',
  ) => {
    setNotice({ id: Date.now(), kind, title, message });
  }, []);

  const refreshArchive = useCallback(async (focusId: string | null = null) => {
    const payload = await responseJson<{
      postcards: Postcard[];
      friends: FriendProfile[];
      orphaned_sender_names?: string[];
      capabilities: ArchiveCapabilities;
      jobs?: ManagementJob[];
    }>(await fetch('/api/archive', { cache: 'no-store' }));
    setPostcards(payload.postcards);
    setFriendProfiles(payload.friends);
    setOrphanedSenderNames(payload.orphaned_sender_names ?? []);
    setCapabilities(payload.capabilities);
    setJobs((current) => current.length ? current : payload.jobs ?? []);
    setArchiveError(null);
    setArchiveReady(true);
    if (focusId) {
      const refreshed = payload.postcards.find((postcard) => postcard.id === focusId) ?? null;
      setActive(refreshed);
    }
    return payload.postcards;
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshArchive().catch((error) => {
        setArchiveError(error instanceof Error ? error.message : '無法連線到資料服務');
        setArchiveReady(true);
        notify('收藏資料未載入；請確認後端與資料庫連線。', 'error', '管理 API 無法連線');
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [notify, refreshArchive]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.kind === 'error' ? 10_000 : 7_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!jobs.some((job) => !isTerminalJob(job))) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [jobs]);

  useEffect(() => {
    const running = jobs.filter((job) => !isTerminalJob(job));
    if (!running.length) return;
    let cancelled = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        for (const current of running) {
          try {
            const payload = await responseJson<{ job: ManagementJob }>(await fetch(`/api/jobs/${encodeURIComponent(current.id)}`, { cache: 'no-store' }));
            if (cancelled) return;
            const batchSize = payload.job.batch_id
              ? jobs.filter((job) => job.batch_id === payload.job.batch_id).length
              : 1;
            if (payload.job.status === 'completed') {
              if (payload.job.kind === 'reresearch') {
                setSortField(defaultSortField);
                setSortDirection(defaultSortDirection);
                setPage(1);
              }
              const updated = await refreshArchive(active?.id === payload.job.postcard_id ? payload.job.postcard_id : null);
              if (cancelled) return;
              if (batchSize === 1 && payload.job.kind === 'add' && payload.job.postcard_id) {
                const added = updated.find((postcard) => postcard.id === payload.job.postcard_id);
                if (added) {
                  setAddOpen(false);
                  setActive(added);
                }
              }
              setJobs((items) => items.map((item) => item.id === payload.job.id ? payload.job : item));
              if (batchSize === 1) {
                notify(
                  payload.job.result?.exact_duplicate
                    ? `圖片已存在，對應 ${payload.job.postcard_id}。`
                    : payload.job.workflow === 'metadata_only'
                      ? '明信片畫面資訊已辨識並建檔；需要時可按「再研究」。'
                      : `${payload.job.kind === 'add' ? '明信片新增與研究' : '再研究'}完成，網站資料已更新。`,
                  'success',
                  payload.job.workflow === 'metadata_only' ? '快速建檔完成' : '研究完成',
                );
              }
            } else {
              setJobs((items) => items.map((item) => item.id === payload.job.id ? payload.job : item));
              if (payload.job.status === 'failed' && batchSize === 1) {
                notify(
                  payload.job.error || 'AI 工作失敗。',
                  'error',
                  payload.job.workflow === 'metadata_only' ? '快速建檔失敗' : '研究失敗',
                );
              }
            }
          } catch (error) {
            if (!cancelled) notify(error instanceof Error ? error.message : '讀取工作狀態失敗。', 'error', '無法讀取研究進度');
          }
        }
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = window.setInterval(poll, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  // The compact status key intentionally restarts polling only when job membership/status changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.map((job) => `${job.id}:${job.status}`).join('|'), notify, refreshArchive, active?.id]);

  useEffect(() => {
    const batches = new Map<string, ManagementJob[]>();
    const timers: number[] = [];
    for (const job of jobs) {
      if (!job.batch_id) continue;
      const batch = batches.get(job.batch_id) ?? [];
      batch.push(job);
      batches.set(job.batch_id, batch);
    }
    for (const [batchId, batch] of batches) {
      if (batch.length < 2 || notifiedBatchesRef.current.has(batchId)) continue;
      if (!batch.every(isTerminalJob)) continue;
      notifiedBatchesRef.current.add(batchId);
      const failed = batch.filter((job) => job.status === 'failed').length;
      const cancelled = batch.filter((job) => job.status === 'cancelled').length;
      const completed = batch.length - failed - cancelled;
      timers.push(window.setTimeout(() => {
        notify(
          failed || cancelled
            ? `${completed} 張完成${failed ? `，${failed} 張失敗` : ''}${cancelled ? `，${cancelled} 張已中止` : ''}；原圖仍保留在本機 intake。`
            : `${completed} 張全部完成，收藏檔案已更新。`,
          failed ? 'error' : 'success',
          batch[0].workflow === 'metadata_only' ? '批次快速建檔完成' : '批次研究完成',
        );
      }, 0));
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [jobs, notify]);

  function openPostcard(postcard: Postcard, navigation?: PostcardNavigation) {
    setMapLoadedFor(null);
    setResearchOpen(false);
    setDeleteConfirm(false);
    setReresearchOpen(false);
    setReresearchNote('');
    if (navigation) setPostcardNavigation(navigation);
    setActive(postcard);
  }

  const closePostcard = useCallback(() => {
    setMapLoadedFor(null);
    setResearchOpen(false);
    setDeleteConfirm(false);
    setReresearchOpen(false);
    setReresearchNote('');
    setPostcardNavigation(null);
    setActive(null);
  }, []);

  function navigatePostcard(direction: -1 | 1) {
    if (!active || !postcardNavigation) return;
    const index = postcardNavigation.ids.indexOf(active.id);
    const nextId = postcardNavigation.ids[index + direction];
    const next = postcards.find((postcard) => postcard.id === nextId);
    if (next) openPostcard(next);
  }

  const closeResearch = useCallback(() => {
    setResearchOpen(false);
    window.requestAnimationFrame(() => researchTriggerRef.current?.focus());
  }, []);

  const closeFriendPostcards = useCallback(() => {
    setActiveFriendName(null);
    window.requestAnimationFrame(() => friendMoreTriggerRef.current?.focus());
  }, []);

  function openFriendPostcards(friendName: string, trigger: HTMLButtonElement) {
    friendMoreTriggerRef.current = trigger;
    setActiveFriendName(friendName);
  }

  function openPostcardFromFriendPopup(postcard: Postcard) {
    const navigation = activeFriendGroup
      ? { source: 'friend' as const, ids: activeFriendGroup.cards.map((card) => card.id), label: activeFriendGroup.name }
      : undefined;
    setActiveFriendName(null);
    openPostcard(postcard, navigation);
  }

  const closeFriendEditor = useCallback(() => {
    setEditingFriendName(null);
    setFriendMergeOpen(false);
    setFriendMergeQuery('');
    setFriendMergeTarget('');
    setFriendDeleteConfirm(false);
    setFriendAction(null);
    window.requestAnimationFrame(() => friendEditorTriggerRef.current?.focus());
  }, []);

  function openFriendEditor(friend: { name: string; baseArea: string | null }, trigger: HTMLButtonElement) {
    friendEditorTriggerRef.current = trigger;
    setEditingFriendName(friend.name);
    setFriendEditName(friend.name);
    setFriendEditBase(friend.baseArea ?? '');
    setFriendMergeOpen(false);
    setFriendMergeQuery('');
    setFriendMergeTarget('');
    setFriendDeleteConfirm(false);
    setNotice(null);
  }

  async function saveFriendInformation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingFriendName) return;
    setFriendAction('save');
    setNotice(null);
    try {
      const previousName = editingFriendName;
      const payload = await responseJson<{ friend: FriendProfile }>(await fetch(
        `/api/friends/${encodeURIComponent(previousName)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: friendEditName, likely_base_area: friendEditBase }),
        },
      ));
      await refreshArchive();
      setExpandedFriendNames((current) => {
        if (!current.has(previousName)) return current;
        const next = new Set(current);
        next.delete(previousName);
        next.add(payload.friend.name);
        return next;
      });
      closeFriendEditor();
      notify(`已更新「${payload.friend.name}」的名稱與可能據點。`, 'success', '寄件者情報已保存');
    } catch (error) {
      notify(error instanceof Error ? error.message : '無法保存寄件者情報。', 'error', '保存失敗');
    } finally {
      setFriendAction(null);
    }
  }

  async function mergeSelectedFriend() {
    if (!editingFriendName || !friendMergeTarget) return;
    setFriendAction('merge');
    setNotice(null);
    try {
      await responseJson(await fetch(`/api/friends/${encodeURIComponent(editingFriendName)}/merge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target_name: friendMergeTarget }),
      }));
      const sourceName = editingFriendName;
      const targetName = friendMergeTarget;
      await refreshArchive();
      closeFriendEditor();
      notify(`「${sourceName}」已合併至「${targetName}」；明信片與異動紀錄均已保留。`, 'success', '寄件者已合併');
    } catch (error) {
      notify(error instanceof Error ? error.message : '無法合併寄件者。', 'error', '合併失敗');
    } finally {
      setFriendAction(null);
    }
  }

  async function recropEditingFriendAvatar() {
    if (!editingFriendName) return;
    setFriendAction('avatar');
    setNotice(null);
    try {
      const payload = await responseJson<{ avatar_generation: { status: string }[] }>(await fetch(
        `/api/friends/${encodeURIComponent(editingFriendName)}/avatar`,
        { method: 'POST' },
      ));
      await refreshArchive();
      const generated = payload.avatar_generation.some((entry) => entry.status === 'generated');
      notify(
        generated
          ? `已從「${editingFriendName}」畫質最佳的可用明信片重新裁切 Mii。`
          : '目前沒有足夠可信的 Mii 裁切提示；既有頭像沒有被低品質結果覆寫。',
        generated ? 'success' : 'error',
        generated ? 'Mii 頭像已更新' : '無法重新截圖',
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : '無法重新截取 Mii。', 'error', '重新截圖失敗');
    } finally {
      setFriendAction(null);
    }
  }

  async function reassessEditingFriendBase() {
    if (!editingFriendName) return;
    setFriendAction('base');
    setNotice(null);
    try {
      const payload = await responseJson<{ friend: FriendProfile }>(await fetch(
        `/api/friends/${encodeURIComponent(editingFriendName)}/base`,
        { method: 'POST' },
      ));
      await refreshArchive();
      setFriendEditBase(payload.friend.likely_base.area ?? '');
      notify(
        payload.friend.likely_base.area
          ? `依目前有效證據，可能據點判定為「${payload.friend.likely_base.area}」。`
          : `目前仍沒有足夠證據判定可能據點：${payload.friend.likely_base.reason}`,
        'success',
        payload.friend.likely_base.area ? '可能據點已重新判定' : '重新判定完成・尚未判定',
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : '無法重新判定可能據點。', 'error', '判定失敗');
    } finally {
      setFriendAction(null);
    }
  }

  async function deleteEditingFriend() {
    if (!editingFriendName) return;
    setFriendAction('delete');
    setNotice(null);
    try {
      const deletedName = editingFriendName;
      await responseJson(await fetch(`/api/friends/${encodeURIComponent(deletedName)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: '使用者由網站 soft delete 寄件者情報' }),
      }));
      await refreshArchive();
      closeFriendEditor();
      notify(`「${deletedName}」已從朋友足跡隱藏；所屬明信片保留並顯示為無主。`, 'success', '寄件者已 soft delete');
    } catch (error) {
      notify(error instanceof Error ? error.message : '無法刪除寄件者情報。', 'error', '刪除失敗');
    } finally {
      setFriendAction(null);
    }
  }

  function toggleReresearch() {
    setDeleteConfirm(false);
    setReresearchOpen((open) => {
      if (!open) window.requestAnimationFrame(() => reresearchNoteRef.current?.focus());
      return !open;
    });
  }

  async function startReresearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    setStartingReresearch(true);
    setNotice(null);
    try {
      const payload = await responseJson<{ job: ManagementJob }>(await fetch(
        `/api/postcards/${encodeURIComponent(active.id)}/research`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ user_note: reresearchNote.trim() || null }),
        },
      ));
      setJobs((items) => [...items.filter((job) => job.id !== payload.job.id), payload.job]);
      setClock(Date.now());
      setReresearchOpen(false);
      setReresearchNote('');
      notify(`${active.poi_name} 已加入研究佇列；你可以關閉明信片繼續瀏覽。`, 'success', 'AI 研究已開始');
    } catch (error) {
      notify(error instanceof Error ? error.message : '無法開始再研究。', 'error', '無法開始再研究');
    } finally {
      setStartingReresearch(false);
    }
  }

  async function confirmDelete() {
    if (!active) return;
    setDeleting(true);
    setNotice(null);
    try {
      await responseJson(await fetch(`/api/postcards/${encodeURIComponent(active.id)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: '使用者由網站移除疑似重複明信片' }),
      }));
      const deletedId = active.id;
      setPostcards((items) => items.filter((postcard) => postcard.id !== deletedId));
      closePostcard();
      notify(`${deletedId} 已 soft delete；原圖、研究、DB 與關聯資料均保留。`, 'success', '明信片已從收藏隱藏');
    } catch (error) {
      notify(error instanceof Error ? error.message : '刪除失敗。', 'error', '刪除失敗');
    } finally {
      setDeleting(false);
    }
  }

  async function cancelManagementJob(job: ManagementJob) {
    setCancellingJobIds((current) => new Set(current).add(job.id));
    setNotice(null);
    try {
      const payload = await responseJson<{ job: ManagementJob }>(await fetch(
        `/api/jobs/${encodeURIComponent(job.id)}/cancel`,
        { method: 'POST' },
      ));
      setJobs((items) => items.map((item) => item.id === payload.job.id ? payload.job : item));
      notify(
        'AI 工作已停止；原圖、intake 與工作紀錄仍保留，可以稍後重新送出。',
        'success',
        'AI 工作已中止',
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : '無法中止 AI 工作。', 'error', '中止失敗');
    } finally {
      setCancellingJobIds((current) => {
        const next = new Set(current);
        next.delete(job.id);
        return next;
      });
    }
  }

  async function submitAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdding(true);
    setNotice(null);
    try {
      const payload = await responseJson<{
        batch_id: string;
        total: number;
        jobs: ManagementJob[];
        job: ManagementJob | null;
        duplicates: ExactDuplicatePrompt[];
        failures: { input_label: string; error: string }[];
      }>(await fetch('/api/postcards', {
        method: 'POST',
        body: new FormData(event.currentTarget),
      }));
      if (payload.jobs.every(isTerminalJob)) {
        notifiedBatchesRef.current.add(payload.batch_id);
      }
      setJobs((items) => [
        ...items.filter((job) => !payload.jobs.some((incoming) => incoming.id === job.id)),
        ...payload.jobs,
      ]);
      setClock(Date.now());
      setSelectedFiles([]);
      setSourceUrls('');
      const runningCount = payload.jobs.filter((job) => !isTerminalJob(job)).length;
      const duplicateCount = payload.duplicates?.length ?? 0;
      if (duplicateCount) {
        setExactDuplicates(payload.duplicates);
        notify(
          `${duplicateCount} 張圖片與既有原圖完全相同；尚未啟動這些圖片的 AI 工作，請在新增視窗中選擇是否改為再研究。${runningCount ? `另有 ${runningCount} 個新圖片工作已排入佇列。` : ''}`,
          payload.failures.length ? 'error' : 'success',
          '需要確認完全相同的圖片',
        );
        return;
      }
      setAddOpen(false);
      setAddNote('');
      if (!runningCount) {
        notify(
          `${payload.failures.length} 張圖片未能處理。`,
          'error',
          '批次處理失敗',
        );
      } else {
        const accepted = payload.jobs.length;
        notify(
          `已接收 ${payload.total} 張：${runningCount} 個 AI 工作已排入佇列${payload.failures.length ? `，${payload.failures.length} 張失敗` : ''}。`,
          payload.failures.length ? 'error' : 'success',
          addWorkflow === 'metadata_only' ? '批次快速建檔已開始' : '批次新增與研究已開始',
        );
        if (accepted === 0) throw new Error('沒有圖片成功建立工作');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : '新增明信片失敗。', 'error', '明信片新增失敗');
    } finally {
      setAdding(false);
    }
  }

  async function continueExactDuplicatesAsReresearch() {
    setAdding(true);
    setNotice(null);
    const uniqueDuplicates = [...new Map(exactDuplicates.map((duplicate) => [duplicate.postcard_id, duplicate])).values()];
    const results = await Promise.allSettled(uniqueDuplicates.map(async (duplicate) => {
      const payload = await responseJson<{ job: ManagementJob }>(await fetch(
        `/api/postcards/${encodeURIComponent(duplicate.postcard_id)}/research`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ user_note: addNote.trim() || null }),
        },
      ));
      return { duplicate, job: payload.job };
    }));
    const started = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    const failedIds = new Set(results.flatMap((result, index) => result.status === 'rejected' ? [uniqueDuplicates[index].postcard_id] : []));
    if (started.length) {
      setJobs((items) => [
        ...items.filter((job) => !started.some((entry) => entry.job.id === job.id)),
        ...started.map((entry) => entry.job),
      ]);
      setClock(Date.now());
    }
    if (failedIds.size) {
      setExactDuplicates((items) => items.filter((item) => failedIds.has(item.postcard_id)));
      const firstFailure = results.find((result) => result.status === 'rejected');
      notify(
        firstFailure?.status === 'rejected' && firstFailure.reason instanceof Error
          ? firstFailure.reason.message
          : `${failedIds.size} 張既有明信片無法開始再研究。`,
        'error',
        '無法開始再研究',
      );
      setAdding(false);
      return;
    }
    setExactDuplicates([]);
    setAddNote('');
    setAddOpen(false);
    setAdding(false);
    notify(
      `${started.length} 張完全相同的圖片沒有重複建檔；既有明信片已加入再研究佇列。`,
      'success',
      '已改為再研究',
    );
  }

  function cancelExactDuplicateResearch() {
    setExactDuplicates([]);
    setAddNote('');
    setAddOpen(false);
    notify('這些重複圖片沒有新增明信片，也沒有啟動 AI 研究。原始上傳紀錄仍保留於 intake。', 'success', '已取消重複圖片');
  }

  const closeAddDialog = useCallback(() => {
    if (adding) return;
    setAddOpen(false);
    setSelectedFiles([]);
    setSourceUrls('');
    setAddNote('');
    setExactDuplicates([]);
  }, [adding]);

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

  function applyPostcardDistanceOrigin(postcard: Postcard) {
    const coordinates = postcardCoordinates(postcard);
    if (!coordinates) return;
    setDistanceOrigin({ ...coordinates, source: 'postcard', label: postcard.poi_name });
    setManualLatitude(String(coordinates.latitude));
    setManualLongitude(String(coordinates.longitude));
    setLocationFeedback(`已使用「${postcard.poi_name}」的研究座標作為距離起點；座標只保存在目前頁面記憶體。`);
    setSortField('distance');
    setSortDirection('asc');
    setQuery('');
    setPage(1);
    setView('archive');
    closePostcard();
    window.requestAnimationFrame(() => {
      document.getElementById('archive')?.scrollIntoView({ block: 'start' });
    });
  }

  function resetArchiveControls() {
    setSenderFilter('all');
    setCountry('all');
    setStatus('all');
    setSortField(defaultSortField);
    setSortDirection(defaultSortDirection);
    setPage(1);
  }

  function goToPage(nextPage: number) {
    setPage(nextPage);
    document.getElementById('archive')?.scrollIntoView({ block: 'start' });
  }

  const senders = useMemo(
    () => [...new Set(postcards.map((postcard) => postcard.sender).filter(Boolean))] as string[],
    [postcards],
  );
  const countries = useMemo(
    () => [...new Set(postcards.map((postcard) => postcard.location.country ?? '未正規化'))],
    [postcards],
  );
  const orphanedSenders = useMemo(() => new Set(orphanedSenderNames), [orphanedSenderNames]);

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
          acquisitionLabel(postcard, Boolean(postcard.sender && orphanedSenders.has(postcard.sender))),
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
  }, [country, distanceOrigin, orphanedSenders, postcards, query, senderFilter, sortDirection, sortField, status]);

  const friendGroups = useMemo(() => {
    return friendProfiles.map((profile) => ({
      name: profile.name,
      modifiedAt: profile.modified_at,
      avatar: profile.avatar,
      cards: postcards
        .filter((postcard) => profile.evidence_postcard_ids.includes(postcard.id))
        .sort((a, b) => (a.found_date ?? '').localeCompare(b.found_date ?? '')),
      signal: profile.likely_base.area ? `${profile.likely_base.area}・早期訊號` : '尚未判定',
      baseArea: profile.likely_base.area,
      confidence: profile.likely_base.confidence_label,
      note: profile.likely_base.reason,
      avoid: profile.avoid_send.areas.length ? profile.avoid_send.areas.join('、') : '無正式建議',
    }));
  }, [friendProfiles, postcards]);
  const friendMergeCandidates = useMemo(() => {
    const normalizedQuery = friendMergeQuery.trim().toLocaleLowerCase('zh-Hant');
    return friendGroups
      .filter((friend) => friend.name !== editingFriendName)
      .filter((friend) => !normalizedQuery || [friend.name, friend.baseArea ?? '']
        .join(' ')
        .toLocaleLowerCase('zh-Hant')
        .includes(normalizedQuery))
      .sort((left, right) => (
        String(right.modifiedAt ?? '').localeCompare(String(left.modifiedAt ?? ''))
        || left.name.localeCompare(right.name, 'zh-Hant')
      ));
  }, [editingFriendName, friendGroups, friendMergeQuery]);
  const activeFriendGroup = activeFriendName
    ? friendGroups.find((friend) => friend.name === activeFriendName) ?? null
    : null;
  const allFriendsExpanded = friendGroups.length > 0
    && friendGroups.every((friend) => expandedFriendNames.has(friend.name));
  const activeMapTarget = active ? mapTargetFor(active) : null;
  const activeCoordinates = active ? postcardCoordinates(active) : null;
  const activeMapIsLoaded = !!active && mapLoadedFor === active.id;
  const chronologicalSort = sortField === 'found_date' || sortField === 'modified_at';
  const filteredCoordinateCount = filtered.filter((postcard) => postcardCoordinates(postcard)).length;
  const pagination = paginateRecords(filtered, page, postcardsPerPage);
  const activeNavigationIndex = active && postcardNavigation
    ? postcardNavigation.ids.indexOf(active.id)
    : -1;
  const activeJob = active
    ? jobs.find((job) => job.kind === 'reresearch' && job.postcard_id === active.id && !isTerminalJob(job))
    : null;
  const runningJobs = useMemo(
    () => jobs.filter((job) => !isTerminalJob(job)),
    [jobs],
  );
  const sourceUrlCount = sourceUrls.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).length;
  const selectedInputCount = selectedFiles.length + sourceUrlCount;

  function setFriendExpanded(friendName: string, open: boolean) {
    setExpandedFriendNames((current) => {
      if (current.has(friendName) === open) return current;
      const next = new Set(current);
      if (open) next.add(friendName);
      else next.delete(friendName);
      return next;
    });
  }

  function toggleAllFriends() {
    setExpandedFriendNames(
      allFriendsExpanded ? new Set() : new Set(friendGroups.map((friend) => friend.name)),
    );
  }

  useEffect(() => {
    if (!active && !addOpen && !activeFriendGroup && !editingFriendName) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (researchOpen) closeResearch();
      else if (active) closePostcard();
      else if (editingFriendName) closeFriendEditor();
      else if (activeFriendGroup) closeFriendPostcards();
      else closeAddDialog();
    };
    document.body.classList.add('modal-open');
    window.addEventListener('keydown', close);
    return () => {
      document.body.classList.remove('modal-open');
      window.removeEventListener('keydown', close);
    };
  }, [active, activeFriendGroup, addOpen, closeAddDialog, closeFriendEditor, closeFriendPostcards, closePostcard, closeResearch, editingFriendName, researchOpen]);

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
        <div className="header-management">
          <a className="settings-link" href="/settings" aria-label="開啟設定頁">設定</a>
          <button type="button" className="add-postcard-button" onClick={() => {
            setAddWorkflow('metadata_only');
            setSelectedFiles([]);
            setSourceUrls('');
            setAddNote('');
            setExactDuplicates([]);
            setAddOpen(true);
            setNotice(null);
          }}>
            ＋ 新增明信片
          </button>
          <div className="archive-state"><span />本機資料庫</div>
        </div>
      </header>

      {notice && (
        <div className={`management-notice notice-${notice.kind}`} role="status" aria-live="polite">
          <span className="management-notice-mark" aria-hidden="true">{notice.kind === 'success' ? '✓' : '!'}</span>
          <span className="management-notice-copy">
            <strong>{notice.title}</strong>
            <small>{notice.message}</small>
          </span>
          <button type="button" onClick={() => setNotice(null)} aria-label="關閉通知">×</button>
        </div>
      )}

      {!archiveReady && (
        <section className="archive-connection-state" role="status" aria-live="polite">
          <div className="sprout-walk" aria-hidden="true">
            <span className="sprout sprout-red"><i /></span>
            <span className="sprout sprout-yellow"><i /></span>
            <span className="sprout sprout-blue"><i /></span>
          </div>
          <div><strong>正在連接資料服務</strong><small>收藏資料與圖片會由後端 API 載入。</small></div>
        </section>
      )}

      {archiveError && (
        <section className="archive-connection-state connection-error" role="alert">
          <div><strong>資料服務暫時無法使用</strong><small>{archiveError}</small></div>
          <button type="button" onClick={() => { setArchiveReady(false); setArchiveError(null); void refreshArchive(); }}>重新連線</button>
        </section>
      )}

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">COLLECTION 01 · 2026</p>
          <h1>Pikmin 明信片<br />收藏研究庫</h1>
          <p className="hero-lede">
            保存原始畫面、地方研究與收藏判斷；朋友據點只在證據足夠時才成立。
          </p>
        </div>
        <div className="hero-stats" aria-label="檔案統計">
          <div><strong>{archiveReady && !archiveError ? postcards.length : '—'}</strong><span>明信片</span></div>
          <div><strong>{archiveReady && !archiveError ? senders.length : '—'}</strong><span>已確認朋友</span></div>
          <div><strong>{archiveReady && !archiveError ? countries.length : '—'}</strong><span>國家／地區</span></div>
          <div><strong>{archiveReady && !archiveError ? postcards.filter((p) => p.research.confidence === 'high').length : '—'}</strong><span>高信心研究</span></div>
        </div>
      </section>

      <aside className="evidence-note">
        <span className="note-symbol">i</span>
        <p><strong>判讀原則</strong>「見つけた日」不是寄送日期；畫面有「フレンドに送る」代表自己發現。寄件人空白不再直接視為未知，只有收到明信片但身分無法確認時才標示「寄件人未知」。</p>
      </aside>

      {!!runningJobs.length && (
        <section className="research-queue-section" aria-labelledby="research-queue-title" aria-label="處理中的明信片">
          <div className="research-queue-heading">
            <div>
              <p className="eyebrow">ACTIVE INTAKE &amp; RESEARCH</p>
              <h2 id="research-queue-title">處理中的明信片</h2>
            </div>
            <p>{runningJobs.length} 項進行中 · 快速建檔與完整研究都會在完成後自動移入收藏檔案</p>
          </div>
          <div className="research-job-grid">
            {runningJobs.map((job) => {
              const postcard = job.postcard_id
                ? postcards.find((candidate) => candidate.id === job.postcard_id) ?? null
                : null;
              return (
                <article className={`research-job-card job-${job.status}`} data-job-id={job.id} key={job.id}>
                  <div className={`research-job-visual ${postcard || job.preview_url ? 'has-image' : 'awaiting-image'}`}>
                    {postcard || job.preview_url ? (
                      <img
                        src={postcard?.asset.path ?? job.preview_url ?? ''}
                        onError={postcard ? (event) => recoverRuntimeAsset(event, postcard.asset.path) : undefined}
                        alt={postcard ? `${postcard.poi_name} 原始明信片畫面` : `${job.input_label ?? '新明信片'}上傳預覽`}
                      />
                    ) : (
                      <div className="sprout-walk" aria-hidden="true">
                        <span className="sprout sprout-red"><i /></span>
                        <span className="sprout sprout-yellow"><i /></span>
                        <span className="sprout sprout-blue"><i /></span>
                      </div>
                    )}
                    <span className="research-job-kind">{managementKindLabel(job)}</span>
                  </div>
                  <div className="research-job-copy">
                    <span className="research-job-status"><i aria-hidden="true" />{managementStatusLabel(job.status, job.workflow)}</span>
                    <h3>{postcard?.poi_name ?? '名稱辨識中'}</h3>
                    <p>{postcard ? `發現日期 · ${compactDate(postcard.found_date)}` : `發現日期 · 辨識中${job.input_label ? ` · ${job.input_label}` : ''}`}</p>
                    <small>{aiProviderLabel(job.provider)} · {job.model} · {reasoningEffortLabel(job.reasoning_effort)}{job.has_user_note ? ' · 含使用者補充' : ''} · {managementStatusLabel(job.status, job.workflow)} · {elapsedLabel(job, clock)}</small>
                    <div className="research-job-progress" role="progressbar" aria-label={`${postcard?.poi_name ?? '新明信片'}處理進度`} aria-valuetext={managementStatusLabel(job.status, job.workflow)}>
                      <span />
                    </div>
                    {job.status !== 'applying' ? (
                      <div className="research-job-actions">
                        <button
                          className="research-job-cancel"
                          type="button"
                          disabled={cancellingJobIds.has(job.id)}
                          onClick={() => void cancelManagementJob(job)}
                          aria-label={`中止 ${postcard?.poi_name ?? job.input_label ?? '明信片'}的工作`}
                        >
                          {cancellingJobIds.has(job.id) ? '中止中…' : '中止工作'}
                        </button>
                      </div>
                    ) : (
                      <p className="research-job-commit-note">正在更新資料庫，已無法中止</p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

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
              <span>排序</span>
              <select aria-label="排序" value={sortField} onChange={(event) => changeSortField(event.target.value as SortField)}>
                <option value="rating">評分</option>
                <option value="found_date">發現日期</option>
                <option value="modified_at">上次修改時間</option>
                <option value="distance">距離</option>
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
            <div className="sort-reset">
              <span>快速操作</span>
              <button
                type="button"
                onClick={resetArchiveControls}
                aria-label="恢復預設：來源、國家、收藏判斷與排序"
              >
                <span aria-hidden="true">↺</span> 恢復預設
              </button>
            </div>
          </div>

          {sortField === 'distance' && (
            <section className="distance-sort-tools">
              <div className="distance-sort-copy">
                <strong>距離基準</strong>
                <span role="status" aria-live="polite">{locationFeedback}</span>
                <small>
                  使用地球曲面直線距離（Haversine）比較參考座標與每張明信片保存的研究座標。
                  目前篩選結果有 {filteredCoordinateCount} / {filtered.length} 張可計算；缺座標者固定排在最後。
                  {distanceOrigin ? ` 目前基準：${distanceOrigin.latitude.toFixed(6)}, ${distanceOrigin.longitude.toFixed(6)}。` : ''}
                </small>
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

          {!archiveReady ? (
            <div className="empty-state"><strong>正在從後端載入收藏檔案…</strong></div>
          ) : archiveError ? (
            <div className="empty-state"><strong>尚未取得收藏資料</strong></div>
          ) : filtered.length ? (
            <div className="postcard-grid">
              {pagination.items.map((postcard) => {
                const distance = distanceOrigin ? distanceKilometers(postcard, distanceOrigin) : null;
                const displayedDate = sortField === 'modified_at' ? modifiedTimestamp(postcard) : postcard.found_date;
                const displayedDateLabel = sortField === 'modified_at' ? '修改' : '發現';
                return (
                  <article className="postcard-card" data-postcard-id={postcard.id} key={postcard.id}>
                    <button className="image-button" onClick={() => openPostcard(postcard, { source: 'archive', ids: filtered.map((item) => item.id), label: '目前明信片排序' })} aria-label={`查看 ${postcard.poi_name}`}>
                      <img src={postcard.asset.path} onError={(event) => recoverRuntimeAsset(event, postcard.asset.path)} alt={`${postcard.poi_name} 原始遊戲截圖`} loading="lazy" decoding="async" />
                      <span className="rating">{postcard.curation.rating == null ? '未評分' : <>{postcard.curation.rating.toFixed(1)} <b>★</b></>}</span>
                      <span className="open-hint">查看檔案 ↗</span>
                    </button>
                    <div className="card-body">
                      <div className="card-kicker">
                        <span className={`status status-${postcard.curation.status}`}>
                          {postcard.research.status === 'metadata_only_pending_research' ? '待研究' : statusLabels[postcard.curation.status]}
                        </span>
                        <time dateTime={displayedDate ?? undefined}>
                          {displayedDateLabel} · {sortField === 'modified_at' ? compactModifiedTime(postcard) : compactDate(displayedDate)}
                        </time>
                      </div>
                      <h3><button onClick={() => openPostcard(postcard, { source: 'archive', ids: filtered.map((item) => item.id), label: '目前明信片排序' })}>{postcard.poi_name}</button></h3>
                      <p className="place" title={researchedLocationDisplay(postcard.location)}>{researchedLocationDisplay(postcard.location)}</p>
                      <p className="sender">{senderLine(postcard, Boolean(postcard.sender && orphanedSenders.has(postcard.sender)))}</p>
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
            <div className="friend-heading-actions">
              <p>只使用已確認寄件人的觀察</p>
              <button
                type="button"
                className="friend-expand-all"
                aria-controls="friend-grid"
                aria-expanded={allFriendsExpanded}
                onClick={toggleAllFriends}
              >
                <span aria-hidden="true">{allFriendsExpanded ? '−' : '＋'}</span>
                {allFriendsExpanded ? '全部收合' : '全部展開'}
              </button>
            </div>
          </div>
          <div className="friend-warning">
            目前資料仍少，所有據點判斷都是保守的早期訊號；單一地點或單日群集不視為生活據點。
          </div>
          <div className="friend-grid" id="friend-grid">
            {friendGroups.map((friend) => (
              <article className="friend-card" key={friend.name}>
                <div className="friend-topline">
                  <div className="avatar">
                    {friend.avatar?.path
                      ? <img src={`${friend.avatar.path}?v=${encodeURIComponent(friend.modifiedAt)}`} onError={(event) => recoverRuntimeAsset(event, friend.avatar!.path)} alt={`${friend.name} 的 Mii 頭像`} loading="lazy" decoding="async" />
                      : friend.name.slice(0, 1)}
                  </div>
                  <div className="friend-identity">
                    <p>寄件人</p>
                    <div className="friend-name-row">
                      <h3>{friend.name}</h3>
                      {friend.baseArea && <span className="friend-base-area">可能據點 · {friend.baseArea}</span>}
                    </div>
                  </div>
                </div>
                <details
                  className="friend-details"
                  open={expandedFriendNames.has(friend.name)}
                  onToggle={(event) => setFriendExpanded(friend.name, event.currentTarget.open)}
                >
                  <summary>
                    <span>
                      展開資料與明信片
                      <small className="friend-postcard-count">{friend.cards.length} 張</small>
                    </span>
                  </summary>
                  <div className="friend-details-body">
                    <div className="friend-details-actions">
                      <button type="button" onClick={(event) => openFriendEditor(friend, event.currentTarget)}>編輯情報</button>
                    </div>
                    <dl>
                      <div><dt>研究信心</dt><dd><span className={`confidence confidence-${friend.confidence}`}>信心 {friend.confidence}</span></dd></div>
                      <div><dt>據點訊號</dt><dd>{friend.signal}</dd></div>
                      <div><dt>觀察數</dt><dd>{friend.cards.length} 張／{new Set(friend.cards.map((p) => p.found_date).filter(Boolean)).size} 個日期</dd></div>
                      <div><dt>避免寄送</dt><dd>{friend.avoid}</dd></div>
                    </dl>
                    <p className="friend-note">{friend.note}</p>
                    <div className="timeline">
                      {friend.cards.slice(0, friendPostcardsPreviewLimit).map((postcard) => (
                        <button key={postcard.id} onClick={() => openPostcard(postcard, { source: 'friend', ids: friend.cards.map((card) => card.id), label: friend.name })}>
                          <time>{postcard.found_date ? postcard.found_date.slice(5).replace('-', '/') : '日期？'}</time>
                          <span>{postcard.poi_name}</span>
                          <small>{researchedLocationDisplay(postcard.location)}</small>
                        </button>
                      ))}
                    </div>
                    {friend.cards.length > friendPostcardsPreviewLimit && (
                      <button
                        type="button"
                        className="friend-more-button"
                        aria-haspopup="dialog"
                        aria-expanded={activeFriendName === friend.name}
                        aria-controls="friend-postcards-dialog"
                        onClick={(event) => openFriendPostcards(friend.name, event.currentTarget)}
                      >
                        <span>更多</span>
                        <small>另外 {friend.cards.length - friendPostcardsPreviewLimit} 張</small>
                      </button>
                    )}
                  </div>
                </details>
              </article>
            ))}
          </div>
        </section>
      )}

      <footer>
        <p>Pikmin Postcard Archive</p>
        <span>原始截圖不可變更 · 研究與推論保留來源及不確定性</span>
      </footer>

      {activeFriendGroup && (
        <div
          className="research-modal-backdrop friend-postcards-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeFriendPostcards(); }}
        >
          <section
            id="friend-postcards-dialog"
            className="research-modal friend-postcards-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="friend-postcards-dialog-title"
            onKeyDown={trapDialogFocus}
          >
            <header className="research-modal-header friend-postcards-modal-header">
              <div>
                <p className="eyebrow">FRIEND POSTCARDS</p>
                <h2 id="friend-postcards-dialog-title">{activeFriendGroup.name} 的明信片</h2>
                <p>全部 {activeFriendGroup.cards.length} 張已確認寄件人觀察</p>
              </div>
              <button type="button" className="research-modal-close" onClick={closeFriendPostcards} aria-label="關閉朋友明信片" autoFocus>×</button>
            </header>
            <div className="research-modal-scroll friend-postcards-modal-scroll">
              <div className="friend-postcards-list">
                {activeFriendGroup.cards.map((postcard) => (
                  <button key={postcard.id} type="button" onClick={() => openPostcardFromFriendPopup(postcard)}>
                    <img src={postcard.asset.path} onError={(event) => recoverRuntimeAsset(event, postcard.asset.path)} alt="" loading="lazy" decoding="async" />
                    <span>
                      <time>{postcard.found_date ? compactDate(postcard.found_date) : '日期未確認'}</time>
                      <strong>{postcard.poi_name}</strong>
                      <small>{researchedLocationDisplay(postcard.location)}</small>
                    </span>
                    <b aria-hidden="true">→</b>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}

      {editingFriendName && (
        <div
          className="research-modal-backdrop friend-editor-backdrop"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeFriendEditor(); }}
        >
          <section
            className="friend-editor-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="friend-editor-title"
            onKeyDown={trapDialogFocus}
          >
            <header className="friend-editor-header">
              <div>
                <p className="eyebrow">FRIEND INFORMATION</p>
                <h2 id="friend-editor-title">編輯情報</h2>
                <p>人工修正會保留在資料庫；之後新增證據時不會覆蓋你指定的可能據點。</p>
              </div>
              <button type="button" onClick={closeFriendEditor} aria-label="關閉寄件者編輯" autoFocus>×</button>
            </header>
            <form className="friend-editor-form" onSubmit={saveFriendInformation}>
              <label htmlFor="friend-edit-name">名稱</label>
              <input
                id="friend-edit-name"
                value={friendEditName}
                onChange={(event) => setFriendEditName(event.target.value)}
                onClick={(event) => event.currentTarget.select()}
                maxLength={80}
                required
              />
              <label htmlFor="friend-edit-base">可能據點</label>
              <input
                id="friend-edit-base"
                value={friendEditBase}
                onChange={(event) => setFriendEditBase(event.target.value)}
                onClick={(event) => event.currentTarget.select()}
                maxLength={240}
                placeholder="尚未判定；留白可人工清除"
              />
              <div className="friend-editor-primary-actions">
                <button type="submit" className="friend-save-action" disabled={Boolean(friendAction)}>
                  {friendAction === 'save' ? '保存中…' : '保存情報'}
                </button>
                <button type="button" onClick={reassessEditingFriendBase} disabled={Boolean(friendAction)} title="依這位寄件者目前保存的有效明信片證據重新判定">
                  {friendAction === 'base' ? '判定中…' : '判定可能據點'}
                </button>
                <button
                  type="button"
                  onClick={() => { setFriendMergeOpen((open) => !open); setFriendDeleteConfirm(false); }}
                  aria-expanded={friendMergeOpen}
                  aria-controls="friend-merge-panel"
                  disabled={Boolean(friendAction)}
                >
                  合併寄件者
                </button>
                <button type="button" onClick={recropEditingFriendAvatar} disabled={Boolean(friendAction)}>
                  {friendAction === 'avatar' ? '重新截圖中…' : '重新截圖'}
                </button>
              </div>
            </form>
            {friendMergeOpen && (
              <section id="friend-merge-panel" className="friend-merge-panel" aria-labelledby="friend-merge-title">
                <div>
                  <p className="eyebrow">MERGE FRIEND</p>
                  <h3 id="friend-merge-title">把「{editingFriendName}」合併至</h3>
                </div>
                <label htmlFor="friend-merge-search">搜尋寄件者</label>
                <input
                  id="friend-merge-search"
                  type="search"
                  value={friendMergeQuery}
                  onChange={(event) => setFriendMergeQuery(event.target.value)}
                  placeholder="名稱或可能據點"
                />
                <div className="friend-merge-list" role="radiogroup" aria-label="選擇合併目標">
                  {friendMergeCandidates.length ? friendMergeCandidates.map((candidate) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={friendMergeTarget === candidate.name}
                      className={friendMergeTarget === candidate.name ? 'selected' : ''}
                      key={candidate.name}
                      onClick={() => setFriendMergeTarget(candidate.name)}
                    >
                      <span>
                        <strong>{candidate.name}</strong>
                        <small>{candidate.baseArea ? `可能據點 · ${candidate.baseArea}` : '可能據點未確認'}</small>
                      </span>
                      <time dateTime={candidate.modifiedAt}>{new Date(candidate.modifiedAt).toLocaleString('zh-TW')}</time>
                    </button>
                  )) : <p className="friend-merge-empty">沒有符合搜尋條件的寄件者。</p>}
                </div>
                <div className="friend-merge-footer">
                  <small>預設依寄件者最後系統修改時間排序。合併會改指明信片，但保留原名稱與合併軌跡。</small>
                  <button type="button" onClick={mergeSelectedFriend} disabled={!friendMergeTarget || Boolean(friendAction)}>
                    {friendAction === 'merge' ? '合併中…' : '確認合併'}
                  </button>
                </div>
              </section>
            )}
            <div className="friend-editor-danger">
              <div>
                <strong>刪除寄件者情報</strong>
                <small>只 soft delete 這筆寄件者；明信片不刪除，並改以無主狀態顯示。</small>
              </div>
              {!friendDeleteConfirm ? (
                <button type="button" onClick={() => { setFriendDeleteConfirm(true); setFriendMergeOpen(false); }} disabled={Boolean(friendAction)}>刪除</button>
              ) : (
                <div className="friend-delete-confirmation" role="alertdialog" aria-label={`確認刪除寄件者 ${editingFriendName}`}>
                  <button type="button" onClick={() => setFriendDeleteConfirm(false)} disabled={Boolean(friendAction)}>取消</button>
                  <button type="button" onClick={deleteEditingFriend} disabled={Boolean(friendAction)}>
                    {friendAction === 'delete' ? '刪除中…' : '確認 soft delete'}
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

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
                <img src={active.asset.path} onError={(event) => recoverRuntimeAsset(event, active.asset.path)} alt={`${active.poi_name} 原始遊戲截圖`} />
                <a href={liveAssetUrl(active.asset.path)} target="_blank" rel="noreferrer">開啟原始尺寸 ↗</a>
              </div>
              <div className="modal-copy-shell">
              <div className="modal-copy">
              <div className="detail-meta">
                <span className={`status status-${active.curation.status}`}>
                  {active.research.status === 'metadata_only_pending_research' ? '待研究' : statusLabels[active.curation.status]}
                </span>
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
                  <small>加入系統 · {compactArchiveTime(active)}</small>
                </div>
                <div><span>來源／寄件人</span><strong>{acquisitionLabel(active, Boolean(active.sender && orphanedSenders.has(active.sender)))}</strong></div>
                <div><span>收藏評分</span><strong>{active.curation.rating == null ? '未評分' : `${active.curation.rating.toFixed(1)} / 5`}</strong></div>
                <div><span>建議</span><strong>{active.curation.recommendation ?? '尚未整理'}</strong></div>
              </div>
              <section className="detail-story">
                {active.research.status === 'metadata_only_pending_research' ? (
                  <div className="research-pending-note">
                    <span className="research-summary-head">
                      <span className="eyebrow">READY FOR RESEARCH</span>
                      <span className="status status-unreviewed">尚未研究</span>
                    </span>
                    <span className="research-summary-copy">{active.research.summary}</span>
                  </div>
                ) : (
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
                )}
              </section>
              {activeMapTarget && (
                <section className="location-map" aria-labelledby="location-map-title">
                  <div className="location-map-heading">
                    <div>
                      <p className="eyebrow">RESEARCHED LOCATION</p>
                      <h3 id="location-map-title">研究定位</h3>
                      <p>{activeMapTarget.label}</p>
                    </div>
                    <div className="location-map-actions">
                      <button
                        type="button"
                        onClick={() => applyPostcardDistanceOrigin(active)}
                        disabled={!activeCoordinates}
                        title={activeCoordinates ? '回到收藏檔案並依此座標由近到遠排序' : '這張明信片尚無可用的研究座標'}
                      >
                        {activeCoordinates ? '以此為距離起點' : '尚無研究座標'}
                      </button>
                      <a href={googleMapsSearchUrl(activeMapTarget.query)} target="_blank" rel="noreferrer">
                        Google Maps ↗
                      </a>
                    </div>
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
                    地圖 marker 由 Google 依研究地址獨立解析；距離計算使用明信片保存的研究座標
                    {`（${geocodeProviderLabel(active.location.geocode?.provider ?? null)}）`}
                    {` · 地址精度：${locationPrecisionLabel(active.location.precision)}`}
                    {active.location.geocode?.precision
                      ? ` · 座標精度：${locationPrecisionLabel(active.location.geocode.precision)}`
                      : ''}
                    {active.location.geocode?.attribution ? ` · ${active.location.geocode.attribution}` : ''}
                  </p>
                </section>
              )}
              {!!active.research.images?.length && (
                <section className="research-image-gallery" aria-labelledby="research-images-title">
                  <div className="research-image-gallery-heading">
                    <div>
                      <p className="eyebrow">RESEARCH IMAGES</p>
                      <h3 id="research-images-title">故事參考圖片</h3>
                    </div>
                    <span>{active.research.images.length} 張</span>
                  </div>
                  <div className="research-image-grid">
                    {active.research.images.slice(0, 3).map((image) => (
                      <figure key={`${image.sha256}-${image.source_page_url}`}>
                        <a href={liveAssetUrl(image.path)} target="_blank" rel="noreferrer" aria-label={`開啟本機保存圖片：${image.caption}`}>
                          <img src={image.path} onError={(event) => recoverRuntimeAsset(event, image.path)} alt={image.alt} loading="lazy" decoding="async" />
                        </a>
                        <figcaption>
                          <strong>{image.caption}</strong>
                          {image.credit && <small>圖片：{image.credit}</small>}
                          <a href={image.source_page_url} target="_blank" rel="noreferrer">查看圖片來源 ↗</a>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </section>
              )}
              <section className="postcard-management" aria-label="明信片管理">
                <div>
                  <p className="eyebrow">MANAGEMENT</p>
                  <strong>資料操作</strong>
                  <small>
                    {capabilities.ai_configured
                      ? `再研究使用 ${aiProviderLabel(capabilities.provider)} · ${capabilities.model} · ${reasoningEffortLabel(capabilities.reasoning_effort)}，工作會在背景持續。`
                      : `${aiProviderLabel(capabilities.provider)} 尚未設定完成；soft delete 仍可使用。`}
                  </small>
                </div>
                <div className="postcard-management-actions">
                  <button
                    type="button"
                    className="research-action"
                    onClick={toggleReresearch}
                    disabled={Boolean(activeJob)}
                    aria-expanded={reresearchOpen}
                    aria-controls="reresearch-note-form"
                  >
                    {activeJob ? `${managementStatusLabel(activeJob.status, activeJob.workflow)} · ${elapsedLabel(activeJob, clock)}` : reresearchOpen ? '收合再研究' : '再研究'}
                  </button>
                  <button type="button" className="delete-action" onClick={() => setDeleteConfirm(true)} disabled={deleting}>
                    刪除
                  </button>
                </div>
                {reresearchOpen && !activeJob && (
                  <form id="reresearch-note-form" className="reresearch-note-form" aria-label="補充再研究資訊" onSubmit={startReresearch}>
                    <label htmlFor="reresearch-note">補充你知道的事（選填）</label>
                    <p>可以寫親身經驗、現場關係、地址線索或網路上查不到的背景。系統會保存原文並列入研究，但不會在沒有其他來源時把個人觀察冒充外部已證實事實。</p>
                    <textarea
                      id="reresearch-note"
                      ref={reresearchNoteRef}
                      value={reresearchNote}
                      onChange={(event) => setReresearchNote(event.target.value)}
                      maxLength={12_000}
                      rows={5}
                      placeholder="例如：我親身到過這裡；入口其實在另一條路上。"
                    />
                    <div className="reresearch-note-footer">
                      <small>{reresearchNote.length.toLocaleString('zh-TW')} / 12,000</small>
                      <div>
                        <button type="button" onClick={() => { setReresearchOpen(false); setReresearchNote(''); }} disabled={startingReresearch}>取消</button>
                        <button type="submit" className="confirm-reresearch" disabled={startingReresearch}>
                          {startingReresearch ? '建立工作中…' : reresearchNote.trim() ? '加入補充並開始再研究' : '開始再研究'}
                        </button>
                      </div>
                    </div>
                  </form>
                )}
                {!!active.user_contributions?.length && (
                  <details className="user-contribution-history">
                    <summary>已保存的使用者補充（{active.user_contributions.length}）</summary>
                    <ol>
                      {active.user_contributions.map((contribution) => (
                        <li key={contribution.job_id}>
                          <time dateTime={contribution.recorded_at}>{new Date(contribution.recorded_at).toLocaleString('zh-TW')}</time>
                          <p>{contribution.body}</p>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                {deleteConfirm && (
                  <div className="delete-confirmation" role="alertdialog" aria-label={`確認刪除 ${active.poi_name}`}>
                    <p>只 soft delete 這一張；原圖、研究、DB 與其他相關明信片都會保留。</p>
                    <div>
                      <button type="button" onClick={() => setDeleteConfirm(false)} disabled={deleting}>取消</button>
                      <button type="button" className="confirm-delete" onClick={confirmDelete} disabled={deleting}>
                        {deleting ? '刪除中…' : '確認 soft delete'}
                      </button>
                    </div>
                  </div>
                )}
              </section>
              <div className="tag-list">{active.curation.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
              {!!active.related_postcards?.length && (
                <div className="related-list">
                  <p className="eyebrow">RELATED POSTCARD</p>
                  {active.related_postcards.map((relation) => {
                    const related = postcards.find((postcard) => postcard.id === relation.id);
                    if (!related) return null;
                    return (
                      <button key={`${relation.id}-${relation.relationship}`} onClick={() => openPostcard(related)}>
                        <img src={related.asset.path} onError={(event) => recoverRuntimeAsset(event, related.asset.path)} alt="" />
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
              {postcardNavigation && activeNavigationIndex >= 0 && (
                <nav className="postcard-context-navigation" aria-label="切換目前脈絡中的明信片">
                  <button
                    type="button"
                    onClick={() => navigatePostcard(-1)}
                    disabled={activeNavigationIndex <= 0}
                    aria-label="上一張明信片"
                  >
                    ←
                  </button>
                  <span>
                    <strong>{postcardNavigation.source === 'friend' ? `寄件者 · ${postcardNavigation.label}` : postcardNavigation.label}</strong>
                    <small>{activeNavigationIndex + 1} / {postcardNavigation.ids.length}</small>
                  </span>
                  <button
                    type="button"
                    onClick={() => navigatePostcard(1)}
                    disabled={activeNavigationIndex >= postcardNavigation.ids.length - 1}
                    aria-label="下一張明信片"
                  >
                    →
                  </button>
                </nav>
              )}
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

      {addOpen && !active && (
        <div className="management-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAddDialog(); }}>
          <section className="management-modal" role="dialog" aria-modal="true" aria-labelledby="add-postcard-title" onKeyDown={trapDialogFocus}>
            <button type="button" className="management-modal-close" onClick={closeAddDialog} aria-label="關閉新增明信片" disabled={adding}>×</button>
            <p className="eyebrow">NEW POSTCARD</p>
            <h2 id="add-postcard-title">新增明信片</h2>
            <p className="management-modal-lede">{exactDuplicates.length
              ? '系統只以完整檔案 bytes 判斷硬重複。以下圖片的 SHA-256 與既有原圖完全相同，因此尚未啟動 AI，也不會新增另一張卡。'
              : '可一次選擇多張圖片，沒有人工張數上限。每張原圖會先保存在本機，再依下方路徑獨立建檔；大量上傳可以先快速新增，之後再逐張使用「再研究」。'}</p>
            {exactDuplicates.length ? (
              <section className="exact-duplicate-confirmation" aria-label="完全相同圖片確認">
                <div className="exact-duplicate-heading">
                  <span aria-hidden="true">!</span>
                  <div>
                    <strong>發現 {exactDuplicates.length} 張完全相同的圖片</strong>
                    <p>若繼續，系統會對既有明信片執行「再研究」，不新增 postcard ID。若取消，不會呼叫 AI。</p>
                  </div>
                </div>
                <ul className="exact-duplicate-list">
                  {exactDuplicates.map((duplicate) => (
                    <li key={`${duplicate.sha256}-${duplicate.input_label}`}>
                      {duplicate.asset_path && (
                        <img
                          src={liveAssetUrl(duplicate.asset_path)}
                          alt=""
                          onError={(event) => recoverRuntimeAsset(event, duplicate.asset_path!)}
                        />
                      )}
                      <span>
                        <small>{duplicate.input_label}</small>
                        <strong>{duplicate.poi_name}</strong>
                        <time>{duplicate.found_date ? `發現日期 ${duplicate.found_date}` : '發現日期未確認'} · {duplicate.postcard_id}</time>
                      </span>
                    </li>
                  ))}
                </ul>
                {addNote.trim() && (
                  <p className="exact-duplicate-note"><strong>將帶入再研究的備註：</strong>{addNote}</p>
                )}
                <div className="exact-duplicate-actions">
                  <button type="button" className="secondary-action" onClick={cancelExactDuplicateResearch} disabled={adding}>取消，不重新研究</button>
                  <button type="button" className="submit-add" onClick={() => void continueExactDuplicatesAsReresearch()} disabled={adding}>
                    {adding ? '正在建立再研究工作…' : '繼續，改為再研究'}
                  </button>
                </div>
              </section>
            ) : (
            <form className="add-postcard-form" onSubmit={submitAdd}>
              <fieldset className="add-workflow-options">
                <legend>新增方式</legend>
                <label className={addWorkflow === 'metadata_only' ? 'selected' : ''}>
                  <input
                    type="radio"
                    name="workflow"
                    value="metadata_only"
                    checked={addWorkflow === 'metadata_only'}
                    onChange={() => setAddWorkflow('metadata_only')}
                    disabled={adding}
                  />
                  <span>
                    <strong>新增明信片</strong>
                    <small>以最低推理（None）快速辨識名稱、見つけた日、遊戲地點與寄件人；不做網路研究，建檔後可按「再研究」。</small>
                  </span>
                </label>
                <label className={addWorkflow === 'full_research' ? 'selected' : ''}>
                  <input
                    type="radio"
                    name="workflow"
                    value="full_research"
                    checked={addWorkflow === 'full_research'}
                    onChange={() => setAddWorkflow('full_research')}
                    disabled={adding}
                  />
                  <span>
                    <strong>新增明信片並研究</strong>
                    <small>每張圖片都建立完整背景研究工作，包含定位、故事、來源、評分、參考圖片與有限關聯。</small>
                  </span>
                </label>
              </fieldset>
              <label>
                <span>本機圖片（可多選）</span>
                <input
                  type="file"
                  name="images"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif"
                  multiple
                  onChange={(event) => setSelectedFiles(Array.from(event.currentTarget.files ?? []))}
                  disabled={adding}
                />
                <small>可一次選擇 20 張以上；不限制批次張數，每張 PNG、JPEG、WebP、GIF 或 HEIC 最多 100 MiB。</small>
              </label>
              {!!selectedFiles.length && (
                <div className="selected-upload-summary" aria-live="polite">
                  <strong>已選擇 {selectedFiles.length} 張本機圖片</strong>
                  <ul>
                    {selectedFiles.slice(0, 5).map((file) => (
                      <li key={`${file.name}-${file.size}`}>{file.name}<span>{(file.size / 1024 / 1024).toFixed(1)} MiB</span></li>
                    ))}
                  </ul>
                  {selectedFiles.length > 5 && <small>以及另外 {selectedFiles.length - 5} 張</small>}
                </div>
              )}
              <div className="form-divider"><span>或一起加入</span></div>
              <label>
                <span>圖片網址（可多筆）</span>
                <textarea
                  name="source_urls"
                  rows={3}
                  value={sourceUrls}
                  onChange={(event) => setSourceUrls(event.target.value)}
                  placeholder={'https://…（支援 Dropbox）\n每行一個圖片網址'}
                  disabled={adding}
                />
                <small>每行一個網址；可與本機圖片一起送出。</small>
              </label>
              <label>
                <span>給這批圖片的備註（選填）</span>
                <textarea name="note" rows={3} value={addNote} onChange={(event) => setAddNote(event.target.value)} placeholder="例如：同一趟旅行、同一位朋友，或希望之後特別注意的線索。" disabled={adding} />
              </label>
              <div className={`api-configuration-state ${capabilities.ai_configured ? 'configured' : ''}`}>
                <span aria-hidden="true" />
                {capabilities.ai_configured
                  ? `AI 已連線 · ${aiProviderLabel(capabilities.provider)} · ${capabilities.model} · ${reasoningEffortLabel(capabilities.reasoning_effort)}`
                  : `${aiProviderLabel(capabilities.provider)} 尚未設定完成；送出後圖片仍會先保存在本機。`}
              </div>
              <button type="submit" className="submit-add" disabled={adding || selectedInputCount === 0}>
                {adding
                  ? `正在保存 ${selectedInputCount} 張並建立工作…`
                  : selectedInputCount === 0
                    ? '請先選擇圖片'
                  : addWorkflow === 'metadata_only'
                    ? `新增 ${selectedInputCount} 張明信片`
                    : `新增 ${selectedInputCount} 張明信片並研究`}
              </button>
            </form>
            )}
          </section>
        </div>
      )}

    </main>
  );
}
