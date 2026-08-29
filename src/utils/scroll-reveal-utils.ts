// 展开折叠区时让页面跟随滚动，确保展开后的内容可见。
// 与「构建信息」展开逻辑一致：先按内容实际高度算出展开增量，
// 若展开后容器底部会超出视口，则在动画时长内用 easeOutCubic 滚动。
export function scrollToRevealAfterExpand(
  growingEl: HTMLElement,
  container: HTMLElement,
  duration: number,
  gapFallback = 20,
): void {
  const scroller = (document.scrollingElement ||
    document.documentElement) as HTMLElement;
  const viewportH = window.innerHeight;

  // 增长高度 = 展开后内容实际高度。
  // grid 子元素即便被 overflow 裁剪，scrollHeight 仍是完整内容高度，用它估算最稳。
  const child = growingEl.firstElementChild as HTMLElement | null;
  const growth = child ? child.scrollHeight : growingEl.scrollHeight;

  // 展开完成后容器底部相对视口的位置 = 当前底部 + 展开增量
  const containerBottom = container.getBoundingClientRect().bottom + growth;

  // 容器间距取父级 row-gap，兜底 gapFallback（用于判定滚动终点）
  const gap =
    parseFloat(
      getComputedStyle(container.parentElement ?? container, "").rowGap,
    ) || gapFallback;

  // 容器底部 + 间距后若未超出视口底部，无需滚动
  if (containerBottom + gap <= viewportH) return;

  const from = scroller.scrollTop;
  const to = from + containerBottom + gap - viewportH;
  const start = performance.now();

  // 页面若开启 scroll-behavior: smooth，逐帧赋值 scrollTop 会被当成连续平滑滚动，
  // 导致滞后、无法与展开动画同步到位。动画期间临时改 auto，结束后恢复。
  const prevBehavior = scroller.style.scrollBehavior;
  scroller.style.scrollBehavior = "auto";

  requestAnimationFrame(function tick(now) {
    const p = Math.min((now - start) / duration, 1);
    scroller.scrollTop = from + (to - from) * (1 - Math.pow(1 - p, 3));
    if (p < 1) requestAnimationFrame(tick);
    else scroller.style.scrollBehavior = prevBehavior;
  });
}
