---
name: pikmin-postcard-intake
description: "接收新的 Pikmin Bloom 明信片圖片、聊天附件、本機路徑或遠端連結時，完成本機保存、畫面判讀、去重、研究、關聯分析、網站與 SQLite 更新及驗證。也適用於修正新證據揭露的既有明信片矛盾；不適用於只瀏覽收藏而不新增或修正資料的要求。"
---

# Pikmin 明信片收錄

在本 repository 內，把一張新圖片處理成可追溯、可驗證的 canonical postcard。除非使用者明確改變範圍，網站維持本機／LAN 使用，不發布到外部 hosting。

## 每次開始時

1. 從 repository root 工作，先讀 `README.md`、`package.json`、目前 migrations，以及與本次資料路徑直接相關的 scripts。不要假設舊指令仍存在。
2. 檢查 `git status --short`；保留使用者原有修改，不覆寫無關變更。
3. 確認圖片來源是聊天附件的本機 path、本機檔案、Dropbox URL 或一般 HTTP(S) URL。缺少可存取的圖片時才請使用者重傳。
4. 若工作會改網站，因為本專案有 `.openai/hosting.json`，依 `sites-building` 的現有網站流程處理；維持使用者指定的 local-only/LAN server。

## 即時回饋契約

工作進行中主動給短更新，不要等到全部完成才揭露問題。至少在下列 checkpoint 回報：

- intake 完成：本機保存位置、SHA-256 與 exact duplicate 結果。
- 畫面判讀完成：可見欄位、來源／寄件人分類及不確定欄位。
- 研究與關聯掃描完成：定位信心、候選關聯及任何矛盾。
- 寫入完成：新增或修改的 postcard IDs、受影響的朋友／關聯，以及驗證狀態。

發現矛盾時立即說明「證據、衝突欄位、影響、建議處理」，同時繼續所有不依賴該答案的安全工作。只有互斥選項會改變 canonical identity、寄件人或是否合併，且本機證據無法解決時，才停下來請使用者決定。

## 不可破壞的不變條件

- 原始圖片必須先落地本機並以 SHA-256 識別；已保存的原圖不可變更、不重新壓縮、不覆寫。之後收到同一張明信片的較高畫質截圖時，保留兩份 bytes 與 checksum，將高畫質版本升為網站 preferred asset，舊檔降為可追溯的 alternate，不可刪除。
- 圖片不以 BLOB 存入 SQLite。DB 保存本機路徑、網站路徑、checksum、欄位、研究、關聯與 provenance。
- 遠端 URL 的 query string 不可原文寫入 DB；使用現有 image intake 保存安全 locator 與完整來源的 hash。
- `見つけた日` 是 `found_date`，不是寄送日期。
- 畫面可見 `フレンドに送る` 代表 `self_found`，此時 `sender: null` 且 `sender_status: not_applicable`。
- 已確認 `○○ より` 才能把姓名存成 sender。收到但名稱留白可標成 `received + unknown`；UI 證據不足則維持 acquisition `unknown`。
- 每次都把畫面可見 sender ID 與現有 friends／postcards 重新比對。不同字串預設為不同的 provisional player，即使 Mii、地點或時間看似相同也不自動建立 alias 或合併；只有使用者明確提出個案合併時才改 player identity。名稱改變本身不能證明是同一人。
- `sender: null` 本身絕不等於未知寄件人。
- raw location、正規化 location、座標／地圖查詢與信心分開保存。沒有可靠證據時，不把 Google 的搜尋結果寫成精確座標。
- condensed `research.summary` 與 `research.detail` 分開。保存不到原長文時明確標示缺漏，不用後寫內容冒充原文。
- 事實、推論與未解問題分欄；每項外部事實保存直接支持它的 URL。
- 不因 metadata 相同刪掉不同圖片；不因外觀相似就宣告 duplicate。

## 收錄流程

### 1. 保存並檢查圖片

使用現有 intake：

```bash
npm run image:ingest -- --source '/path/or/https-url'
```

若 shell 沒有套用 `.node-version`，改用 `mise exec node@22.23.2 -- npm ...`。記錄輸出的 SHA-256、media type、bytes、local path 和 status。以可用的圖片檢視工具查看已落地的本機檔案，不依聊天縮圖做最終判讀。

如果格式無法由瀏覽器直接顯示，仍保留原始 bytes；只有在資料模型明確支援 original + derived asset 後才能增加衍生圖，不可用轉檔取代原檔。

同時記錄可客觀比較的品質訊號：pixel dimensions、檔案 bytes、格式，以及肉眼可見的縮放、壓縮或模糊。若 metadata 與畫面確認是同一張明信片但新檔更清晰：

1. 將新檔以不同路徑保存，不覆寫舊檔。
2. 在 postcard asset／provenance 中同時保留兩個 checksum、來源與品質訊號，明確標出 preferred 與 alternate。
3. 網站、研究放大圖與其他 derived assets 改指向 preferred；既有歷史 checksum 仍可驗證。
4. 若目前 schema 還不能表達多版本 asset，先新增 migration、snapshot round-trip 與 integrity tests，再 promotion；不可只換檔案讓 DB checksum 失真。
5. 重新產生受影響的 Mii crop 或縮圖，並在交付時說明升級前後來源。

### 2. 擷取畫面證據

逐項辨識並區分「看得到」與「推論得到」：

- POI 名稱與可能的名稱變體。
- `見つけた日`。
- 遊戲顯示 location 原文。
- `フレンドに送る` 是否可見。
- sender panel、`○○ より`、空白 sender area。
- Mii avatar 是否清楚可裁切；只做原圖像素裁切，不用生成式方法重畫人物。記錄來源 postcard ID、來源 checksum 與 crop box，讓未來更清晰來源可以安全取代 derived avatar。
- star、刪除 toast、其他能支持收藏狀態的 UI。

依 `lib/acquisition.mjs` 建立 acquisition，不要在別處複製另一套規則。OCR 或視覺不清楚的字元保留疑問，不自行補成看似合理的名稱。

### 3. 去重；先決定 identity 再研究

使用 canonical 圖片或 intake 的本機路徑執行：

```bash
npm run check:duplicate -- \
  --image /local/image \
  --poi 'POI name' \
  --found-date YYYY-MM-DD \
  --origin self_found
```

`--origin` 依證據改為 `self_found`、`received` 或 `unknown`；只有 received 且姓名已確認時才另外加上 `--sender 'confirmed sender'`。

依序處理：

1. 相同 SHA-256：同一 canonical asset，不新增 postcard；保留新的 intake source／occurrence provenance。
2. 相同 `POI + found_date + sender／acquisition identity` 但 bytes 不同：視為 probable duplicate candidate，人工比較；通常保留成不同 canonical screenshot，並建立雙向 `same-metadata-different-image`。
3. 只有 POI 名稱接近、名稱變體或位置相同：不是 duplicate。需要時建立雙向 `same-poi-name-variant`。
4. 已確認寄件人不同，或 `self_found` 與 `received unknown` 不同：不可靜默合併。
5. sender ID 與既有名稱不同：先建立另一個 friend profile；可回報疑似改名線索，但除非使用者明確要求，不把兩個 profile 或其觀察歷史合併。

若 exact duplicate 與使用者所稱「全新」衝突，回報 checksum 證據並只新增 provenance，不複製 canonical record。

### 4. 研究地點與故事

對非 exact duplicate 做與收藏價值成比例的研究。需要最新、精確位置、外部來源或不熟悉的 POI 時使用 web search；優先官方登錄、場館、政府、作者／組織及可靠地圖來源。

研究輸出至少包含：

- normalized location 與 confidence；可靠時才填 latitude/longitude。
- condensed summary，供列表與 modal 快速閱讀。
- preserved detail，包含較完整脈絡。
- confirmed facts、inferences、unresolved questions。
- sources；每個 URL 必須實際打開並支持相鄰主張。
- curation rating、recommendation、status 與 tags；不確定時用 `unreviewed`，不要為了完整而假造評分。
- map query 或座標的依據。地名解析尚未人工確認時，明確維持 query-level precision。

保存完整研究到 `research/raw/`，並讓 `research.detail.source_path` 指向它。新研究可使用 `structured_preserved`；不得把新研究標成歷史原文。

### 5. 搜尋資料庫關聯

在新增前後都掃描 SQLite／`data/postcards.json`，至少比較：

- SHA-256、metadata dedupe key。
- NFC 正規化後的 POI 名稱、別名、同地點不同名稱。
- location raw/display、座標與鄰近位置。
- sender、found date、同日群集與跨日重複出現。
- tags、研究摘要、confirmed facts、sources 中的同一建物／作品／事件。

只把目前 schema 與 UI 支援的關係寫入 `related_postcards`，而且必須雙向。時間群集、朋友據點或主題相似先作研究推論，不塞進不相符的 relationship type。若新的關係類型確有持續價值，先回報設計影響，再一起更新 schema、TypeScript、UI 與 tests。

新增 confirmed sender 證據後重建／更新 `data/friends.json`。單張、單日或旅遊群集不足以宣告生活據點；證據不足時維持 low confidence 或 needs-review。

Friends 頁面的 Mii avatar 使用最高品質、可確認寄件人的證據截圖產生：

```bash
npm run friends:avatars -- --commit
```

這是可丟棄後重建的 derived asset，不是身份證明。每次加入同一名稱的新證據，都比較來源像素尺寸與實際清晰度；更好的候選應更新 avatar path／checksum／crop provenance，但保留原始 postcard assets。不同 sender ID 的 Mii 看似相同時仍維持兩個 profile，等待使用者個案合併指示。

### 6. Canonicalize 並同步網站／DB

優先使用已有、可 dry-run 的專案 script，不執行臨時 SQL 直接拼出半套資料。若專案仍缺少「單張 intake promotion」工具，先把這視為 workflow gap 回報，並在本次收錄範圍內建立可重複執行的 script，而不是手工維護多份耦合資料。它至少要：

- 接受 intake SHA-256 與結構化 metadata。
- dry run 預覽 ID、路徑、duplicate／relations 與受影響 records；只有 `--commit` 才寫入。
- 先備份 DB／snapshots，選下一個不重用的 `pc-XXXX` ID。
- byte-for-byte 複製原圖到 `public/images/postcards/YYYY/MM/`，先驗證目標不存在或 checksum 相同。
- 原子更新 `data/postcards.json`、必要的 friends/import/provenance 與 `research/raw/`。
- 用 `db/snapshots.mjs` 同步 SQLite，讓相同 hash 的 `image_intake` 成為 `canonicalized`。
- 失敗時不刪除 intake 原圖，不留下指向不存在檔案的 DB record。

網站原則上直接讀 snapshots；只有新增欄位或互動需要時才修改 UI。任何資料模型改動使用新的 migration，不改寫已套用的 migration。Map iframe 維持使用者點擊後才載入，不能讓新增資料導致首頁一次載入多張地圖。

### 7. 驗證與交付

至少執行：

```bash
npm test
npm run lint
npx tsc --noEmit
npm run db:verify
npm run db:stats
npm run build
```

再確認：

- 新圖片 HTTP 200，bytes 與 SHA-256 正確。
- JSON ↔ SQLite round trip 無損，foreign keys 無違規。
- duplicate totals、research detail totals、friend evidence 與雙向 relations tests 已依新增資料更新。
- production server 若原本在跑，完成 build 後重啟同一個 LAN service，不留下重複 server。
- `git diff --check` 通過，且 diff 沒有無關或使用者原有修改。

完成時回報 canonical ID、checksum、來源分類、研究／定位信心、duplicate／relationship 結果、受影響的 friend records、驗證結果與仍待使用者判斷的問題。依 repository 既有工作方式建立單一聚焦 commit。

## 矛盾與自我修正迴圈

每次收錄都重新檢查新證據是否推翻舊資料或本 Skill：

1. **資料矛盾**：raw UI、使用者補充、外部來源、DB 舊值不一致時，全數保留 provenance；標出哪一項是 observation、哪一項是 inference。修正所有受影響的 postcards、friends、relations 與研究，不只修新 record。
2. **identity 矛盾**：checksum、metadata 和 sender/acquisition 給出不同結論時，不自動 merge。回報候選 IDs、每條證據與最保守的處理。
3. **研究矛盾**：可靠來源互相衝突時降低 confidence，寫入 unresolved questions；不要挑一個方便的答案掩蓋衝突。
4. **流程矛盾**：若現有 script、schema、tests 或本 Skill 造成資料遺失、重工或錯誤分類，立即回報這個 workflow gap，做最小、可驗證的改進，再重新執行受影響步驟。
5. **Skill 回寫**：當錯誤是可重複的規則缺漏，而非單張明信片的例外，在同一任務內窄幅修改本 `SKILL.md`。不要為單一例外累積普遍規則；例外留在該 postcard 的 evidence/provenance。
6. 修改 Skill 後執行 skill-creator 的 `quick_validate.py`，再跑相關 project tests。最終明確列出「Skill 改了什麼、哪個觀察觸發、如何防止重犯」。

不要為了讓舊 tests 通過而維持已被證據推翻的資料，也不要在沒有證據時擴大自動推論。
