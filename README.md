# HEART 政策島：我的角色

已經被官方收錄
你不再需要這個外掛了！

在 [puma.taipei/heart-island](https://puma.taipei/heart-island)（沈伯洋「台北順起來」政策島）的 3D 場景裡，捏一個自己的角色放進去。

> 這是第三方使用者腳本（userscript），不是站方官方功能，作者 readper。

## 功能

- **捏角色**：髮型、髮色、膚色、眼睛、嘴巴、臉部配件、衣款與顏色、帽子、背部／手持／同行物、身高與體型。「身分」只提供預設配件，之後每項都能自己改。尺寸與動作照站方小人的定義，手腳會擺動，點角色鏡頭會跟著走。
- **行程**：自動逛逛、點地圖指定地點、前往某個島或建築，或照站方原本的 20 條協作流、89 條路線走。
- **試衣**：在「外觀」頁籤時，角色會移到不會有人經過的外島，面向鏡頭方便看臉。
- **拍照**：在「拍照」頁籤把自己或複製的 Puma 放到場景任何地方、指定面向，並可隱藏名牌與標記。試衣時也能開「與 Puma 合照」。
- 角色設定只存在你瀏覽器的 localStorage（`heart-me:v1`），不會送到任何地方。

## 安裝

腳本只有一個檔案，需要先裝「使用者腳本管理器」，再安裝腳本。

**腳本網址（點開後管理器會跳出安裝畫面）：**
<https://raw.githubusercontent.com/readper/heart-island-me/main/heart-island-me.user.js>

### 電腦：Chrome / Edge / Brave

1. 安裝 [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)。
2. 較新版 Chrome / Edge（Manifest V3）要先允許使用者腳本：到 `chrome://extensions`（Edge 為 `edge://extensions`）→ 該擴充功能「詳細資料」→ 開啟「允許使用者指令碼」；舊版則是開啟右上角「開發人員模式」。
3. 開啟上面的腳本網址，按「安裝」。
4. 開 [puma.taipei/heart-island](https://puma.taipei/heart-island)，工具列會出現「☺ 我的角色」。

### 電腦：Firefox

1. 安裝 [Tampermonkey](https://addons.mozilla.org/firefox/addon/tampermonkey/) 或 [Violentmonkey](https://addons.mozilla.org/firefox/addon/violentmonkey/)。
2. 開啟腳本網址，按「安裝」。

### 電腦：Safari（macOS）

1. 從 App Store 安裝 [Userscripts](https://apps.apple.com/app/userscripts/id1463298887)（免費）或 Tampermonkey for Safari。
2. 到 Safari「設定 → 延伸功能」啟用，並允許在 puma.taipei 使用。
3. Userscripts：按工具列圖示 → 設定腳本資料夾，把 `heart-island-me.user.js` 下載到該資料夾；或直接開腳本網址，由 Userscripts 提示安裝。

### Android：Firefox（建議）

Android 版 Chrome 不支援擴充功能，請改用 Firefox：

1. 安裝 Firefox for Android，到「選單 → 附加元件」安裝 Tampermonkey 或 Violentmonkey。
2. 用 Firefox 開啟腳本網址，按「安裝」。
3. 用 Firefox 開 puma.taipei/heart-island。

（Kiwi Browser、Edge Android 等支援擴充功能的瀏覽器也能用同樣方式。）

### iPhone / iPad：Safari

1. 從 App Store 安裝 [Userscripts](https://apps.apple.com/app/userscripts/id1463298887)，依 App 內說明選好腳本資料夾（建議放 iCloud 雲碟）。
2. 到「設定 → Safari → 延伸功能 → Userscripts」開啟，權限選「允許」，並對 puma.taipei 設為「永遠允許」。
3. 在 Safari 開腳本網址，Userscripts 會提示安裝；或把 `.user.js` 存進腳本資料夾。
4. 開 puma.taipei/heart-island，若沒出現按鈕，點網址列左邊的「aA」→ 管理延伸功能確認 Userscripts 已開啟。

（Tampermonkey for iOS、Stay 也能用。）

### 更新

腳本檔頭有更新網址，管理器會自動檢查新版；也可手動重新開啟腳本網址覆蓋安裝。

## 使用

開啟站方頁面後，工具列出現「☺ 我的角色」。面板有三個頁籤：

| 頁籤 | 內容 |
| --- | --- |
| 外觀 | 捏角色；開著時角色會到外島試衣，可開「與 Puma 合照」 |
| 行程 | 自動逛逛、指定地點、前往島／建築、站方原本路線 |
| 拍照 | 把自己或 Puma（複製）放到任意位置與面向、拍照模式 |

## 給站方：如何關閉

站方若不希望這個腳本運作，在自己的頁面加下列任一項，腳本就會停用並移除它放進場景與頁面的所有東西（約每 0.5 秒偵測一次，載入前後都有效）：

```js
window.HEART_ISLAND_ALLOW_MODS = false;
```

```html
<meta name="heart-island-mods" content="off">
```

```js
window.heartCity.allowMods = false;
```

## 已知限制

- 手機與電腦的版面在 Chrome 裝置模擬下測過，尚未在真機（含 iOS Safari）完整測試。
- 腳本依賴站方目前的頁面結構（three.js、`window.heartCity`）；站方改版後可能失效。

## 回報問題

請到 [Issues](https://github.com/readper/heart-island-me/issues)。
