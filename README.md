# Pikmin Postcard Archive

Pikmin Bloom 明信片的本機收藏、研究與朋友活動範圍證據庫。

目前已匯入 bootstrap bundle 的 20 張明信片。原始截圖、來源 manifest、長版研究、SHA-256 與來源 session 都有保留；`見つけた日` 永遠視為 `found_date`，不會當作寄送日期。

## 啟動網站

需要 Node.js 22.13 以上；專案的 `.node-version` 固定為 22.23.2。

```bash
npm install
npm run dev:lan
```

若目前 shell 尚未自動套用 `.node-version`，可直接使用：

```bash
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

- `public/images/postcards/`：不可變更的原始截圖。
- `data/postcards.json`：網站使用的 canonical postcard records。
- `data/friends.json`：由已確認寄件人觀察形成的保守推論。
- `data/imports.json`：來源 bundle 與 checksum 紀錄。
- `research/raw/`：詳細研究、來源與未解問題。
- `imports/current-session/`：來源 session 的原始 manifest 與說明。
- `imports/source-bundles/`：原始 ZIP bundle。
- `scripts/normalize-current-session.mjs`：由原始 manifest 重建 canonical records。
- `scripts/check-duplicate.mjs`：兩階段去重檢查。

## 尚待合併

另一個 postcard ChatGPT session 的 bundle 尚未取得。收到後先以截圖 hash 去重，再比對 POI、`found_date` 與寄件人；任何研究與 provenance 都應保留。
