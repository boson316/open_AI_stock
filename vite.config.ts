import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// GitHub Pages 不能自訂回應標頭，改用 <meta> 設定內容安全政策：只允許同源的程式與資料，
// 樣式允許行內（React style 屬性與 ECharts 需要），圖片允許 data:／blob:（圖表匯出 PNG／SVG）。
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");
const securityMeta = {
  name: "security-meta",
  apply: "build" as const,
  transformIndexHtml: () => [
    { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" as const },
    { tag: "meta", attrs: { name: "referrer", content: "strict-origin-when-cross-origin" }, injectTo: "head-prepend" as const },
  ],
};
export default defineConfig({
  plugins: [react(), tailwindcss(), securityMeta],
  base: process.env.VITE_BASE_PATH || "/open_AI_stock/",
  test: {
    environment: "jsdom",
    include: ["tests/frontend/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/frontend/setup.ts"],
  },
});
