/**
 * 寬表格在手機上要左右滑動：替可捲動的 .table-scroll 加上 is-scrollable／at-end 類別，
 * CSS 據此顯示「左右滑動」提示與右側漸層，滑到底後隱藏。
 */
export function installScrollHints(root: HTMLElement) {
  const update = (el: Element) => {
    const s = el as HTMLElement;
    const scrollable = s.scrollWidth > s.clientWidth + 4;
    s.classList.toggle("is-scrollable", scrollable);
    s.classList.toggle("at-end", !scrollable || s.scrollLeft + s.clientWidth >= s.scrollWidth - 4);
  };
  const seen = new WeakSet<Element>();
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((es) => es.forEach((e) => update(e.target)));
  const scan = () =>
    root.querySelectorAll(".table-scroll").forEach((el) => {
      if (seen.has(el)) return update(el);
      seen.add(el);
      el.addEventListener("scroll", () => update(el), { passive: true });
      resize?.observe(el);
      update(el);
    });
  if (typeof MutationObserver !== "undefined") new MutationObserver(scan).observe(root, { childList: true, subtree: true });
  scan();
}
