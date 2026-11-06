import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./theme.css";
import "./research.css";
import { installScrollHints } from "./lib/scrollHints";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
installScrollHints(document.getElementById("root")!);
// 正式網站註冊離線快取（開發模式不註冊，避免快取干擾除錯）。
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        // 把這次用到的程式、樣式、資料交給離線快取；之後切換分頁載入的檔案由 service worker 自動存。
        const send = () =>
          reg.active?.postMessage({
            type: "cache-urls",
            urls: [
              location.href.split("#")[0],
              ...performance.getEntriesByType("resource").map((r) => r.name),
            ],
          });
        // 等首頁載完再存，避免和第一次載入搶頻寬。
        setTimeout(send, 6000);
        setTimeout(send, 20000);
      })
      .catch(() => {
        /* 不支援或被封鎖時照常使用網站 */
      });
  });
}
