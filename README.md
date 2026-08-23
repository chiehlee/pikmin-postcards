# Pikmin Postcard Archive

Pikmin Bloom 明信片的本機收藏、研究與朋友活動範圍證據庫。

目前已合併兩個 source-session bundles，共 148 張 canonical 明信片與 1 張情境截圖。原始截圖、來源 manifest、可復原的長版研究、SHA-256 與來源 session 都有保留；`見つけた日` 永遠視為 `found_date`，不會當作寄送日期。

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

## 測試與驗證

```bash
npm run test:unit
npm run test:regression
npm run test:functional
npm run test:ui
npm run verify
```

- `test:unit`：純函式與領域規則，包含 line 95%、branch 80%、function 95% 的 coverage gate。
- `test:regression`：canonical 圖片、資料筆數、來源分類、雙向關聯、JSON ↔ SQLite round-trip 與既有 bug cases。
- `test:functional`：先 production build，再從外部邊界測試圖片 intake、關聯候選 CLI、HTTP 網站與 canonical 圖片。
- `test:ui`：以 Playwright Chromium 在桌面與手機 viewport 操作 production UI；涵蓋 modal 捲動、鍵盤／焦點、背景關閉與 Google Map 延遲載入。失敗時保留 screenshot、trace 與 video。
- `test:quick`：開發中快速執行 unit + regression。
- `test:watch`：修改程式時持續重跑 unit + regression，提供即時回饋。
- 第一次在新電腦執行 UI test 前先跑 `npx playwright install chromium`。`npm test` 等同完整的 `test:all`；`npm run verify` 再加上 lint、TypeScript、DB integrity/query plans 與資料統計，是 commit 前固定入口。

測試檔必須以 `.unit.test.mjs`、`.regression.test.mjs` 或 `.functional.test.mjs` 結尾。Regression suite 會檢查分類，避免新測試因為命名錯誤而沒有被固定入口執行。新增或改變行為時，同一個變更必須新增或修改至少一個能觀察該行為的測試；修 bug 時，能重現問題的 regression test 應先於修正通過。

檢查單張圖片或 metadata 是否已存在：

```bash
npm run check:duplicate -- \
  --image /path/to/postcard.png \
  --poi '金字塔2' \
  --found-date 2026-05-17 \
  --origin self_found
```

去重順序：

1. 圖片 SHA-256 完全相同：確定重複。
2. `POI + found_date + sender／來源狀態` 完全相同：可能重複，交由人工確認。
3. 已確認寄件人不同：不自動合併。

## 來源與寄件人判讀

`sender: null` 不等於「未知寄件人」。每張明信片另有 `acquisition`，把來源和寄件人狀態分開：

- 畫面可見 `フレンドに送る`：`self_found`，代表自己發現；寄件人欄位不適用。
- 畫面有已確認的 `○○ より`：`received`，並保存實際寄件人。
- 收到的明信片沒有可確認名稱，例如好友已移除後畫面留白：`received`，但 `sender_status` 為 `unknown`。
- UI 證據不足時才使用 `acquisition.type: unknown`，不以 `sender: null` 自動猜測。

未來的 session manifest 應盡量保存 `send_to_friend_button_visible`、`sender_panel_visible` 與 `sender_area_blank`。匯入器會依這些畫面證據建立來源分類；沒有證據時維持未知，不套用整批猜測。

## 研究筆記保存方式

列表與明信片視窗先顯示適合快速閱讀的 `research.summary`；按下視窗內的 `RESEARCH NOTE` 會開啟獨立、可捲動的長版研究視窗，再顯示保存下來的 `research.detail`、已確認事實、推論、未解問題與來源路徑。關閉長版研究後會回到原本的明信片視窗與觸發按鈕。

每張明信片的長版狀態會明確保存為：

- `raw_preserved`：有原始研究段落可回溯。
- `structured_preserved`：有當時保存下來的結構化研究內容。
- `not_recovered`：來源記錄顯示曾研究過，但匯出時原研究回合已不在可用 transcript；只標示缺漏，不用新寫內容冒充原文。

新 bundle 的 manifest 可在每張 postcard 加上 `research_detail`（或相容欄位 `research_detail_body`）；匯入器會和 condensed `research_summary` 分開保存。

## Google Maps 研究定位

有保存研究內容的明信片會顯示「研究定位」。外部 Google Maps 搜尋連結與內嵌地圖都不需要本機 API key；內嵌使用 Google Maps 的分享式地圖網址，並且只在使用者按下「載入 Google Map」後建立單一 iframe，不會在首頁或開啟明信片視窗時預先載入。若 Google 日後變更分享式嵌入行為，右上角的外部 Google Maps 連結仍可作為 fallback。

定位資料遵守兩個層級：明信片或 DB 有經緯度時直接用該座標；只有研究地名時以明確的查詢字串交給 Google 解析，UI 會標示「尚非人工確認座標」，不把搜尋結果冒充精確位置。

## 地名的原文與譯名

每張 postcard 的 `location.raw` 永遠保存遊戲畫面原字串，UI 以「遊戲顯示：」呈現，不會被研究結果覆寫。粗體研究地名使用分開的欄位：

- `endonym`：研究確認的當地原名；日本用日文、臺灣／香港／澳門用繁體中文、韓國用韓文、美國用英文，其他地區依當地語言。
- `zh_tw`：當 `endonym` 不是中文或日文時保存台灣慣用的繁體中文譯名；UI 組成 `原名（台灣繁中譯名）`。
- `country_endonym`：當地語言的國家名。臺灣、日本以外的主標會在原名及繁中譯名最後附上國家。
- `address_local`：研究能支持的最完整當地地址，提供地圖查詢；它可以比畫面主標更精確。
- `precision`：目前可靠精度，例如 `district`、`locality`、`road` 或 `full_address`。
- `language`：原名語言標籤；`name_status` 與 `name_confidence` 分別保存研究狀態及信心。
- `display`：由上述欄位組成的快取，測試會確認它沒有與 `endonym`／`zh_tw` 分岔。

主標依收藏者的生活尺度統一：臺灣有證據時顯示到路／街及段，完整巷弄門牌只放 `address_local`；日本有證據時顯示到丁目・番・号；兩地若證據不足就依序退回町里、區市與都道府縣。其他地區顯示到可確認的城市內區域，並在末尾附當地語言國名；非中日文另附含國名的台灣繁中譯名。地圖查詢使用 `address_local`，不把括號譯名送進 Google。既有資料的可重跑回填入口是 `npm run backfill:location-names`；先 dry-run，確認覆蓋後再加 `-- --commit`。

## 資料結構

- `var/pikmin-postcards.sqlite3`：本機 SQLite operational database（不進 Git）。
- `var/image-inbox/`：尚未 canonicalize 的本機圖片 intake（以 SHA-256 命名，不進 Git）。
- `db/migrations/`：可版控、依序執行的資料庫 schema migrations。
- `public/images/postcards/`：不可變更的原始截圖。
- `data/postcards.json`：網站使用、可攜且可版控的 canonical postcard snapshot。
- `data/friends.json`：由已確認寄件人觀察形成的保守推論。
- `data/context.json`：不應混入明信片列表的收藏清單／情境截圖。
- `data/imports.json`：來源 bundle 與 checksum 紀錄。
- `research/raw/`：長版研究、保存狀態、來源與未解問題。
- `imports/current-session/`：來源 session 的原始 manifest 與說明。
- `imports/source-bundles/`：原始 ZIP bundle。
- `scripts/normalize-current-session.mjs`：只用於建立全新 repo 時產生第一包 bootstrap records。
- `scripts/merge-session-bundle.mjs`：驗證 ZIP 內所有 checksum，合併新 bundle 並保留 provenance。
- `scripts/check-duplicate.mjs`：兩階段去重檢查。

圖片不存進 SQLite；資料庫只保存圖片的本機路徑、網站路徑、checksum、欄位、關聯、研究來源與 provenance。Canonical 圖片的 `assets.local_path` 會指向 `public/images/...`；尚待整理的圖片則由 `image_intake.local_path` 指向 `var/image-inbox/...`。這能讓原圖繼續當作不可變更檔案保存，也避免資料庫隨圖片數量快速膨脹。

## 匯入單張圖片

聊天附件先使用附件在本機的實際路徑；一般本機圖片與 Dropbox／HTTP(S) 連結使用同一個入口：

```bash
npm run image:ingest -- --source '/local/path/postcard.png'
npm run image:ingest -- --source 'https://www.dropbox.com/scl/fi/.../postcard.png?rlkey=...&dl=0'
```

匯入器會依序下載或讀取圖片、檢查格式與 100 MiB 上限、計算 SHA-256、以 content-addressed 名稱落地，再寫入 DB。新圖片會標記為 `pending`；若 checksum 已屬於 canonical asset，則直接標記為 `canonicalized` 並指向既有的 `public/images/...`。相同圖片或相同來源重送不會建立重複檔案。

遠端 URL 的 query string 不會原文存進資料庫；DB 只保留移除 query 後的位置與完整來源字串的 SHA-256，避免把 Dropbox token 類資訊寫入紀錄。圖片成為正式明信片後，bundle merge／`db:sync` 會把相同 checksum 的 intake 自動連回 canonical asset。

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
