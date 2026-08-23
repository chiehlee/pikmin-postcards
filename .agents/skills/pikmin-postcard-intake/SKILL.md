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
- 每個可獨立驗證的修改完成：立即執行最小相關 suite；失敗時先回報被破壞的行為，再修正，不把失敗累積到最後。

發現矛盾時立即說明「證據、衝突欄位、影響、建議處理」，同時繼續所有不依賴該答案的安全工作。只有互斥選項會改變 canonical identity、寄件人或是否合併，且本機證據無法解決時，才停下來請使用者決定。

## 不可破壞的不變條件

- 原始圖片必須先落地本機並以 SHA-256 識別；已保存的原圖不可變更、不重新壓縮、不覆寫。每一份 bytes 不同的 imported screenshot 都有自己的 postcard ID；POI 名稱、日期、地點或遊戲中的明信片物件都不是 primary key。只有完全相同的 SHA-256 才共用 canonical asset 並增加 occurrence provenance。
- 圖片不以 BLOB 存入 SQLite。DB 保存本機路徑、網站路徑、checksum、欄位、研究、關聯與 provenance。
- 遠端 URL 的 query string 不可原文寫入 DB；使用現有 image intake 保存安全 locator 與完整來源的 hash。
- `見つけた日` 是 `found_date`，不是寄送日期。
- 畫面可見 `フレンドに送る` 代表 `self_found`，此時 `sender: null` 且 `sender_status: not_applicable`。
- 已確認 `○○ より` 才能把姓名存成 sender。收到但名稱留白可標成 `received + unknown`；UI 證據不足則維持 acquisition `unknown`。
- 每次都把畫面可見 sender ID 與現有 friends／postcards 重新比對。不同字串預設為不同的 provisional player，即使 Mii、地點或時間看似相同也不自動建立 alias 或合併；只有使用者明確提出個案合併時才改 player identity。名稱改變本身不能證明是同一人。
- `sender: null` 本身絕不等於未知寄件人。
- raw location、研究後當地原名、台灣繁中譯名、完整地址、顯示精度、座標／地圖查詢與信心分開保存。`location.raw` 必須逐字保留遊戲畫面；`location.endonym` 使用當地原文，`location.address_local` 保存來源能支持的最完整當地地址，`location.precision` 明示可靠層級。臺灣主標有證據時到路／街及段，完整巷弄門牌留給 `address_local`；日本有證據時主標到丁目・番・号；兩地證據不足就由町里、區市、都道府縣逐級退回。臺灣、日本以外顯示城市內可確認區域，並在原文末尾附 `country_endonym`；非中日文另填 `zh_tw`，繁中括號內也在末尾附台灣譯名國家。所有地名層級與國家之間統一用半形逗號加空格 `, `，包括中文 endonym 與括號內繁中譯名；不得產生全形逗號分隔。中文或日文的 `zh_tw` 維持 null。`location.display` 只作為共用 formatter 組成的快取，地圖 query 使用 `address_local` 與必要的當地國名，不得拿 raw 或含括號譯名的 display 冒充研究定點。尚未研究完成時用 `language: und`、`name_status: provisional`、`precision: unknown` 與低信心，不假裝已確認。沒有可靠證據時，不把搜尋結果寫成精確地址或座標。
- 明信片拍到紀念碑、遺址標、復刻物或移設物時，canonical `location` 定位畫面中的現物；所紀念事件、原建物或原物件的歷史位置另存於 research facts／inferences／unresolved questions，並分別表達精度與信心。不得把現物的精確地址或座標冒充歷史事件的精確位置，也不因歷史基址未定就降低現物定位的信心。
- condensed `research.summary` 與 `research.detail` 分開。`research.detail` 必須是可獨立閱讀的研究稿，不是摘要換句話說；對具有歷史、文化或空間考證價值的題材，依證據涵蓋現物身分、事件時間線、人物／組織、時代與地點脈絡、來源衝突或限制、後續發展／紀念方式，以及這張卡的收藏解讀。沒有證據的面向直接省略，不以泛論灌水。保存不到原長文時明確標示缺漏，不用後寫內容冒充原文。
- 使用者要求補做 `not_recovered` 研究時，保留原缺漏的歷史 provenance，另用帶日期的新 research status 與新的 `research/raw/` 檔保存「本次重做」；不可覆寫成已復原舊文。批次補做要有 manifest 或等價的確定性輸入，先 dry-run 驗證目標集合完全相符，再以 regression test 鎖定覆蓋數、來源檔與零殘留 `not_recovered`。
- 事實、推論與未解問題分欄；每項外部事實保存直接支持它的 URL。
- 不因 metadata 相同刪掉、隱藏或合併不同圖片；不因外觀相似就宣告可移除的 duplicate。duplicate candidate 與 relationship 只供檢查，只有使用者明確提出個案時才能移除或合併 postcard。

## 收錄流程

### 1. 保存並檢查圖片

使用現有 intake：

```bash
npm run image:ingest -- --source '/path/or/https-url'
```

若 shell 沒有套用 `.node-version`，改用 `mise exec node@22.23.2 -- npm ...`。記錄輸出的 SHA-256、media type、bytes、local path 和 status。以可用的圖片檢視工具查看已落地的本機檔案，不依聊天縮圖做最終判讀。

如果格式無法由瀏覽器直接顯示，仍保留原始 bytes；只有在資料模型明確支援 original + derived asset 後才能增加衍生圖，不可用轉檔取代原檔。

同時記錄可客觀比較的品質訊號：pixel dimensions、檔案 bytes、格式，以及肉眼可見的縮放、壓縮或模糊。若 metadata 與畫面確認是同一張明信片但新檔更清晰：

1. 將新檔以不同路徑及新的 postcard ID 保存，不覆寫、隱藏或刪除舊 postcard。
2. 為兩張建立適當的雙向關聯並記錄品質訊號；回報哪張較適合作為放大檢視、Mii crop 或其他 derived asset 的來源。
3. 可以自動改用較清晰來源重新產生 Mii crop 或縮圖，但收藏列表中的兩張 postcard 都維持可見。
4. 只有使用者明確要求個案 replace／merge 時，才把其中一張改為 alternate 或從收藏移除；promotion 前須讓 schema、snapshot round-trip 與 integrity tests 能保存兩個 checksum 和來源。

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

### 3. 相似檢查；先建立 screenshot identity 再研究

使用 canonical 圖片或 intake 的本機路徑執行：

```bash
npm run check:duplicate -- \
  --image /local/image \
  --poi 'POI name' \
  --found-date YYYY-MM-DD \
  --location 'raw location' \
  --origin self_found
```

`--origin` 依證據改為 `self_found`、`received` 或 `unknown`；只有 received 且姓名已確認時才另外加上 `--sender 'confirmed sender'`。

依序處理：

1. 相同 SHA-256：同一份 screenshot bytes 與 canonical asset，不新增 postcard；保留新的 intake source／occurrence provenance。
2. 相同 `POI + found_date + location + sender／acquisition identity` 但 bytes 不同：一定先建立新的 postcard ID，再標成 candidate 並視需要建立雙向 `same-metadata-different-image`；candidate 不表示應刪除。
3. POI 相同但 location 不同：不是 duplicate candidate；同名 Wayspot 在不同地點是正常資料。只有名稱變體且其他證據指向同一處時，才考慮雙向 `same-poi-name-variant`。
4. 已確認寄件人不同，或 `self_found` 與 `received unknown` 不同：不可靜默合併。
5. sender ID 與既有名稱不同：先建立另一個 friend profile；可回報疑似改名線索，但除非使用者明確要求，不把兩個 profile 或其觀察歷史合併。

任何 probable／visual duplicate 都不得阻止新 screenshot 建立 postcard ID。只有 exact SHA-256 重複時共用 canonical record 並新增 provenance；若使用者之後指定移除或合併，再依該個案操作。

### 4. 研究地點與故事

對非 exact duplicate 做與收藏價值成比例的研究。需要最新、精確位置、外部來源或不熟悉的 POI 時使用 web search；優先官方登錄、場館、政府、作者／組織及可靠地圖來源。

研究輸出至少包含：

- normalized location 與 confidence；可靠時才填 latitude/longitude。
- 研究地名的 `endonym`、`address_local`、`precision`、`country_endonym`、BCP-47 風格 `language`、必要時的台灣繁中 `zh_tw`，以及 name status/confidence；先依臺灣道路／日本丁目番號／其他地區城市內區域＋國名的層級取可由來源支持的最深精度，再逐級 fallback。相同 raw location 可先查既有命名 registry/索引再研究，避免逐張重做。研究結果不得覆寫 `raw`。
- condensed summary，供列表與 modal 快速閱讀。
- preserved detail，須可不依賴 condensed summary 獨立理解研究對象；有足夠材料時用清楚的小節依序交代時間線、行動者、空間證據、歷史影響與仍不能確定之處，避免只把 summary 擴寫成一段長文。
- 對證據充足且具有歷史、文化或空間考證價值的題材，長版研究以約 1,500–4,000 個繁中文字元作為「非常長」的目標區間；4,000 是一般 UI 研究的軟上限，不是每張都要填滿的最低要求。題材或證據較少時應按比例縮短，不用泛論、重複摘要或無來源敘事湊字數；若確有必要超過上限，先在工作回饋說明新增篇幅回答了什麼問題。
- confirmed facts、inferences、unresolved questions。
- sources；每個 URL 必須實際打開並支持相鄰主張。
- curation rating、recommendation、status 與 tags；不確定時用 `unreviewed`，不要為了完整而假造評分。
- map query 或座標的依據。地名解析尚未人工確認時，明確維持 query-level precision。
- 若 POI 是紀念物，分開交代「現物在哪裡」、「紀念什麼／原址在哪裡」及兩者的空間關係；只有來源能支持時才宣稱原址、同址或精確基址。

保存完整研究到 `research/raw/`，並讓 `research.detail.source_path` 指向它。新研究可使用 `structured_preserved`；不得把新研究標成歷史原文。

### 5. 用索引找 Related Postcard

不要為了找關聯把 `data/postcards.json` 全文、全部圖片或全部研究內容載入模型。Postcard 數量會持續增加，而 Related Postcard 是 best-effort enrichment，不要求 100% recall。canonical record 寫入 SQLite 後先執行：

```bash
npm run related:candidates -- --id pc-XXXX --limit 8
```

工具只用 SQLite indexes 對 exact POI、raw/display location、sender＋日期、tags、research source 與鄰近座標各取有限候選，再合併評分。預設最多輸出 8 張，不輸出圖片或長 research text。依下列 token budget 工作：

1. 先看短候選，不掃完整 archive。
2. 最多深入開啟前 3 張的圖片與 research detail；弱訊號或沒有候選就停止。
3. 只有關聯能用一句具體的話說清楚時才寫入，例如同一 postcard 的不同截圖、同一地點／作品系列、共享可辨識主題，或有來源支持的歷史連結。
4. 同 country、常見 tag、同 sender 或時間接近本身只供召回，不能單獨成為關聯理由。
5. 外部調查只用於已出現的強候選，不為追求完整關聯圖做開放式搜尋。漏掉低訊號關聯可以接受；後續有新證據時再補。

關聯寫入 `related_postcards` 時使用簡短且語意清楚的 `relationship`，並在可選的 `note` 保存上述一句話理由；兩端必須使用相同 relationship 與 note。UI 標題固定為 `RELATED POSTCARD`。時間群集或朋友據點若沒有 postcard-to-postcard 的具體敘事，只保留為研究推論。新增 relationship type 不需先掃全部資料；若需要新欄位或不同 UI，才同步更新 migration、snapshots、TypeScript 與 tests。

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

### 6A. 網站內新增、soft delete 與再研究

網站管理操作與 CLI 收錄共用本 Skill 的證據、圖片、定位、研究、duplicate 及 relation 規則，不建立較寬鬆的第二套捷徑：

1. **新增**：先把上傳檔或遠端 URL 落地 `var/image-inbox/`、驗證格式／大小並計算 SHA-256，再判斷 exact duplicate。即使 `OPENAI_API_KEY` 尚未設定，已驗證的圖片仍保留在 intake；不得因 AI 無法啟動而遺失來源。Exact duplicate 不再呼叫 AI，也不建立新的 postcard ID；非 exact duplicate 才建立背景研究工作。
2. **Soft delete**：只在被操作的 postcard 寫入 lifecycle／`deleted_at` 與原因，正常列表與查詢預設隱藏該 record。不得連帶刪除、隱藏或改寫 related postcards、朋友證據、原圖、研究檔、來源、provenance 或 DB row；已使用的 postcard ID 永不回收。若未來加入 restore，應清除 lifecycle 而不是複製舊 record。
3. **再研究**：畫面可見 metadata、`location.raw`、asset checksum、原始研究檔與既有 provenance 都是不可靜默覆寫的證據。新結果使用帶日期的新 research status 與新的 `research/raw/` 檔，新增 provenance 指回再研究前的 detail path；只有通過 schema、location、acquisition、source URL 與 relation candidate 驗證後才更新 canonical snapshot／DB。
4. **有限關聯**：送給模型的 related candidates 必須來自 SQLite 索引的有限集合（預設最多 8），不得把整個 archive 或全部長版研究塞進 prompt。模型只能從候選集合選 relation；寫入時再次檢查 ID、未刪除狀態、一句具體 note 與雙向一致性。
5. **非同步工作**：每個 add／reresearch job 保存 kind、status、建立／開始／完成時間、model、完整自動 prompt、SKILL path／SHA-256、OpenAI response ID、結果或錯誤。狀態依序為 queued／in_progress／applying／completed 或 failed；UI 每秒顯示 elapsed time，定期 poll，reload 後也要從 DB 恢復未完成工作。只有 validated result 能進入 applying；失敗保留 job 與 intake，不留下半套 canonical record。
6. **API key 與網路邊界**：`OPENAI_API_KEY` 只能由 server process 的環境變數讀取，不得送進 client bundle、API response、snapshot、SQLite、prompt、log 或 Git。瀏覽器只讀取 `ai_configured` 布林狀態。寫入 endpoint 至少驗證 same-origin；目前仍只在可信任 LAN／VPN 開放，若改為多人或公開網路，先加入身分驗證、授權、rate limit 與支出限制。
7. **原子更新與回饋**：OpenAI background response 完成不等於資料已寫入；必須先進入 applying，保存新的 research raw file，備份 DB，驗證 snapshot ↔ SQLite round-trip，再標 completed。任何可重複出現的 schema、prompt、研究或 UI 問題都回到本 Skill、自動 prompt builder 與對應 test 一起修正。

### 7. 測試、驗證與交付

先依改動選擇測試層級；同一項行為不需要在三層重複測試，但不可沒有對應層級：

- 純函式、排序、判讀與 domain rule 使用 `.unit.test.mjs`。
- canonical totals、不可變圖片、既有 bug、資料關聯與 JSON ↔ SQLite round-trip 使用 `.regression.test.mjs`。
- CLI、filesystem、SQLite 寫入、下載與 production HTTP 邊界使用 `.functional.test.mjs`；只操作 temp DB／temp directory，不修改 canonical archive。
- 使用者口述的 UI 行為、互動 bug、modal／scroll、keyboard／focus、responsive layout 或第三方 iframe 載入，使用 `tests/ui/*.spec.ts` 的 Playwright test 操作 production UI；至少覆蓋直接相關的桌面與手機 viewport。不可只用 source regex、CSS 字串或 HTTP response 代替瀏覽器行為驗證。失敗 artifacts 保留 screenshot 與 trace；需要理解使用者看到的狀況時，實際檢視 Playwright screenshot 再調整。

新增或修改 production behavior、schema、script 或 workflow 時，必須在同一變更新增或修改至少一個能觀察結果的 test。修 bug 時，在可行範圍內先寫出會失敗的 regression test，再修實作。純新增 postcard 資料至少更新／通過 explicit totals 與 archive integrity；若它揭露新的規則邊界，再補對應 unit 或 regression case。不得用刪除 assertion、放寬 expected value 或跳過 suite 來掩蓋 regression。

開發中先執行受影響的單一檔案或：

```bash
npm run test:quick
# 需要持續回饋時使用 npm run test:watch
```

純研究文字、facts、sources 或既有 postcard 資料的局部更新，先跑直接相關的 regression、JSON／SQLite sync 與 integrity check；若 production snapshot 由 build 產生，再完成 build 與目前服務的 HTTP smoke test。這類變更不因單張內容調整而無條件重跑 Playwright 或整套 `verify`，可在批次邊界集中執行。

新增或修改 UI、production code、schema、script、workflow，或進行 release／批次交付時，執行：

```bash
npm run verify
```

`verify` 必須涵蓋 unit coverage gate、regression、functional production build／HTTP、Playwright production UI、lint、TypeScript、DB integrity／query plans 與 stats。Node test 檔名使用 `.unit.test.mjs`、`.regression.test.mjs` 或 `.functional.test.mjs`；Playwright tests 使用 `tests/ui/*.spec.ts`。suite meta-test 會拒絕未分類的 Node tests，並確認 UI suite 已納入固定 gate，避免新 test 靜默漏跑。

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
6. **關聯回饋**：若候選常出現無意義結果、漏掉使用者指出的強關聯，或 token 成本持續偏高，先調整 index、訊號權重、候選上限或 deep-review 上限，不以全 archive 掃描當補救。
7. 修改 Skill 後執行 skill-creator 的 `quick_validate.py`，再跑相關 project tests。最終明確列出「Skill 改了什麼、哪個觀察觸發、如何防止重犯」。

不要為了讓舊 tests 通過而維持已被證據推翻的資料，也不要在沒有證據時擴大自動推論。
