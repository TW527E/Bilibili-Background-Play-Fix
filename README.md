[繁體中文](README.md) | [English](README.en.md)

# Bilibili Safari 背景播放修復

一個專為 Safari 與 Tampermonkey 製作的使用者腳本，用來改善 Bilibili 切換到背景分頁後容易停止播放、卡住，以及不再繼續緩衝後續內容的問題。

## 快速安裝

Greasy Fork 頁面建立後即可直接安裝；目前也可以從 GitHub 手動安裝 [`bilibili-safari-background-play.user.js`](bilibili-safari-background-play.user.js)。

## 功能

- 切換到其他 Safari 分頁後，維持原本已由使用者開始的播放。
- 避免 Bilibili 因 Page Visibility API 回報背景狀態而主動暫停播放或分段載入。
- 持續將動態建立或替換的媒體元素設為 `preload="auto"`。
- 使用低頻 Worker watchdog 檢查背景播放進度。
- 背景中發生意外 `pause`、`waiting`、`stalled` 或 `suspend` 時嘗試恢復。
- 播放進度長時間停止時，只在已緩衝的區間內做 1ms seek，喚醒 Safari 媒體管線。
- 尊重使用者操作：從未開始的影片不會自動播放，在前景手動暫停後也不會擅自恢復。
- 不蒐集、不儲存、不傳送任何資料，也不會發出額外網路請求。

## 支援頁面

- Bilibili 一般影片
- 播放清單與稍後再看類型的播放頁
- 番劇播放頁
- Festival 播放頁
- Bilibili 行動版影片及番劇頁

## 系統需求

- macOS
- Safari
- [Tampermonkey for Safari](https://www.tampermonkey.net/?browser=safari)

## 安裝

### Greasy Fork

1. 在 Safari 安裝並啟用 [Tampermonkey](https://www.tampermonkey.net/?browser=safari)。
2. 前往 Greasy Fork 腳本頁面。
3. 選擇安裝腳本，並在 Tampermonkey 確認安裝。
4. 重新整理已開啟的 Bilibili 播放頁。

### 手動安裝

1. 開啟 Tampermonkey Dashboard，新增一個 userscript。
2. 刪除編輯器中的預設內容。
3. 貼入 [`bilibili-safari-background-play.user.js`](bilibili-safari-background-play.user.js) 的完整內容並儲存。
4. 重新整理 Bilibili 播放頁。

> `@run-at document-start` 很重要。它讓腳本能在 Bilibili 註冊背景分頁處理邏輯前，先接管 Page Visibility API。

## 使用方式

1. 在 Bilibili 開始播放影片。
2. 等待播放器載入一些內容。
3. 切換到其他 Safari 分頁；播放與後續緩衝會繼續進行。
4. 回到 Bilibili 後，進度應保持連續。

不需要額外設定。若要暫停播放，先回到 Bilibili 分頁再按暫停即可。

## 狀態與偵錯

在 Safari Web Inspector Console 查看狀態：

```js
__bilibiliSafariBackgroundPlayFix.status()
```

開啟偵錯訊息：

```js
__bilibiliSafariBackgroundPlayFix.setDebug(true)
```

手動觸發一次檢查：

```js
__bilibiliSafariBackgroundPlayFix.rescue()
```

## 實作方式

腳本會先保存 Safari 原生的頁面可見狀態 getter，再對 Bilibili 回報 `document.hidden === false` 與 `document.visibilityState === "visible"`。因此網站不會因切換分頁主動停用播放排程，但腳本本身仍知道頁面是否真的位於背景。

watchdog 只有在「使用者原本要求播放」且「頁面真的位於背景」時才介入。如果播放仍正常前進，它不會 seek 或重啟播放器。

## Safari 限制

`preload="auto"` 是瀏覽器提示，不是強制命令。Safari 仍可依記憶體、網路與省電狀態限制背景頁；作業系統在極端資源壓力下也可能凍結或回收整個分頁。

## 檔案

- [`bilibili-safari-background-play.user.js`](bilibili-safari-background-play.user.js) — Tampermonkey 使用者腳本
- [`README.md`](README.md) — 繁體中文說明
- [`README.en.md`](README.en.md) — English documentation
- [`tests/userscript.test.cjs`](tests/userscript.test.cjs) — Node.js 測試

## 開發檢查

```bash
npm run check
npm test
```

## 授權

本專案採用 [MIT License](LICENSE)。
