# Pikmin Postcard Archive

Pikmin Bloom 明信片的本機收藏、研究與朋友活動範圍證據庫。

目前已合併兩個 source-session bundles，共 148 張 canonical 明信片與 1 張情境截圖。原始截圖、來源 manifest、長版研究、SHA-256 與來源 session 都有保留；`見つけた日` 永遠視為 `found_date`，不會當作寄送日期。

## 啟動網站

需要 Node.js 22.13 以上；專案的 `.node-version` 固定為 22.23.2。

```bash
npm install
npm run db:sync
npm run dev:lan
```

若目前 shell 尚未自動套用 `.node-version`，可直接使用：

```bash
mise exec node@22.23.2 -- npm run db:sync
mise exec node@22.23.2 -- npm run dev:lan
```

服務會監聽 `0.0.0.0:3000`：

- 本機：`http://localhost:3000`
- 區網／VPN：`http://<這台 Mac 的 VPN 或區網 IP>:3000`

目前沒有登入機制。只應在可信任的區網或 VPN 上開放，並由主機防火牆限制可連線來源。

正式建置與啟動：

```bash
npm run build
npm run start:lan
```

若未自動套用 Node 版本，啟動指令改為：

```bash
mise exec node@22.23.2 -- npm run start:lan
```

## 驗證

```bash
npm test
npm run lint
npm run build
npm run db:verify
```

檢查單張圖片或 metadata 是否已存在：

```bash
npm run check:duplicate -- \
  --image /path/to/postcard.png \
  --poi '金字塔2' \
  --found-date 2026-05-17
```

去重順序：

1. 圖片 SHA-256 完全相同：確定重複。
2. `POI + found_date + sender` 完全相同：可能重複，交由人工確認。
3. 已確認寄件人不同：不自動合併。

## 資料結構

- `var/pikmin-postcards.sqlite3`：本機 SQLite operational database（不進 Git）。
- `db/migrations/`：可版控、依序執行的資料庫 schema migrations。
- `public/images/postcards/`：不可變更的原始截圖。
- `data/postcards.json`：網站使用、可攜且可版控的 canonical postcard snapshot。
- `data/friends.json`：由已確認寄件人觀察形成的保守推論。
- `data/context.json`：不應混入明信片列表的收藏清單／情境截圖。
- `data/imports.json`：來源 bundle 與 checksum 紀錄。
- `research/raw/`：詳細研究、來源與未解問題。
- `imports/current-session/`：來源 session 的原始 manifest 與說明。
- `imports/source-bundles/`：原始 ZIP bundle。
- `scripts/normalize-current-session.mjs`：只用於建立全新 repo 時產生第一包 bootstrap records。
- `scripts/merge-session-bundle.mjs`：驗證 ZIP 內所有 checksum，合併新 bundle 並保留 provenance。
- `scripts/check-duplicate.mjs`：兩階段去重檢查。

圖片不存進 SQLite；資料庫只保存圖片路徑、checksum、欄位、關聯、研究來源與 provenance。這能讓原圖繼續當作不可變更檔案保存，也避免資料庫隨圖片數量快速膨脹。

### SQLite 與網站 snapshot

目前網站仍讀取 `data/*.json`，因此建置內容可重現、可由 Git 檢視，也不會讓瀏覽器直接碰資料庫。SQLite 是本機查詢、去重與匯入流程使用的結構化資料層；合併新 bundle 時會同步更新資料庫與 JSON snapshot。

從版控中的 JSON 重建／同步本機資料庫（若已有 DB，會先備份到 `var/backups/`）：

```bash
npm run db:sync
```

查看統計並檢查資料庫完整性、foreign keys、JSON 無損 round-trip 與主要 query plans：

```bash
npm run db:stats
npm run db:verify
```

需要把資料庫內容重新輸出為網站 snapshot 時：

```bash
npm run db:export
```

覆寫 `data/` 前，舊 snapshot 也會先備份到 `var/backups/`。現階段適合單機／單一寫入者；若未來變成多台主機或多人同時寫入，再把相同 schema 遷移到 PostgreSQL 會比較合適。

## 合併新的 session bundle

先執行 dry run：

```bash
npm run merge:bundle -- --bundle /path/to/bundle.zip --id unique-session-id
```

確認報告後才寫入：

```bash
npm run merge:bundle -- --bundle /path/to/bundle.zip --id unique-session-id --commit
```

合併先以截圖 hash 去重，再比對 POI、`found_date` 與寄件人。Byte-identical 重貼會收斂為一個 canonical asset，但每次出現仍保存在來源 ZIP 與 provenance；不同截圖即使 metadata 相同也不會被刪除。
