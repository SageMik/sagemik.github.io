/**
 * TOC (Table of Contents) 工具类
 * 用于 SidebarTOC 和 FloatingTOC 的共享逻辑
 */

import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import {
	computeTocItems,
	renderTocItemHTML,
	type TocInput,
} from "@/utils/toc-shared";

export interface TOCConfig {
	contentId: string;
	indicatorId: string;
	maxLevel?: number;
}

/** 标题管辖的内容区间：本标题位置 → 下一标题位置（末个取文档底部） */
interface HeadingSpan {
	id: string;
	top: number;
	bottom: number;
}

/**
 * 参考线容差（px）。锚点定位后标题并非精确停在参考线上——标题文档坐标带小数、
 * 滚动位置又按整像素取整，实测偏差约 0.3px。容差内的残留内容肉眼不可见，
 * 应视为已滚过参考线，否则点击目录后上一个标题会赖在指示器范围内。
 */
const REFERENCE_LINE_TOLERANCE = 2;

export class TOCManager {
	private tocItems: HTMLElement[] = [];
	private maxLevel: number;
	private scrollTimeout: number | null = null;
	private scrollFrame: number | null = null;
	private contentId: string;
	private indicatorId: string;

	constructor(config: TOCConfig) {
		this.contentId = config.contentId;
		this.indicatorId = config.indicatorId;
		this.maxLevel = config.maxLevel || 3;
	}

	/**
	 * 查找文章内容容器
	 */
	private getContentContainer(): Element | null {
		return (
			document.querySelector(".custom-md") ||
			document.querySelector(".prose") ||
			document.querySelector(".markdown-content")
		);
	}

	/**
	 * 查找所有标题
	 */
	private getAllHeadings(): HTMLElement[] {
		const contentContainer = this.getContentContainer();
		if (!contentContainer) {
			return [];
		}
		return Array.from(
			contentContainer.querySelectorAll("h1, h2, h3, h4, h5, h6"),
		);
	}

	/**
	 * 获取标题的纯文本内容（排除 script/style 标签的文本）
	 */
	private getCleanTextContent(element: HTMLElement): string {
		const clone = element.cloneNode(true) as HTMLElement;
		for (const el of clone.querySelectorAll("script, style")) {
			el.remove();
		}
		return clone.textContent || "";
	}

	/**
	 * 空状态文案
	 */
	private getEmptyStateHTML(): string {
		return `<div class="text-center py-8 text-gray-500 dark:text-gray-400"><p>${i18n(I18nKey.tocEmpty)}</p></div>`;
	}

	/**
	 * 将 DOM 标题转换为与服务端一致的 TocInput
	 */
	private domHeadingsToInputs(headings: HTMLElement[]): TocInput[] {
		return headings.map((heading) => {
			const depth = Number.parseInt(heading.tagName.charAt(1), 10);
			let text = this.getCleanTextContent(heading)
				.replace(/#+\s*$/, "")
				.trim();

			// 空文本回退（例如动态副标题）
			if (!text) {
				const dataSubtitles = heading.getAttribute("data-subtitles");
				if (dataSubtitles) {
					try {
						const subtitles = JSON.parse(dataSubtitles);
						text = Array.isArray(subtitles) ? subtitles[0] : subtitles;
					} catch {
						// ignore
					}
				}
			}

			return { depth, slug: heading.id, text };
		});
	}

	/**
	 * 生成TOC HTML（客户端 fallback 路径，与服务端 SSR 输出保持一致）
	 */
	public generateTOCHTML(): string {
		const headings = this.getAllHeadings();

		if (headings.length === 0) {
			return this.getEmptyStateHTML();
		}

		const items = computeTocItems(this.domHeadingsToInputs(headings), {
			maxLevel: this.maxLevel,
		});

		if (items.length === 0) {
			return this.getEmptyStateHTML();
		}

		let tocHTML = "";
		for (const item of items) {
			tocHTML += renderTocItemHTML(item);
		}

		tocHTML += `<div id="${this.indicatorId}" style="opacity: 0;" class="toc-active-indicator"></div>`;

		return tocHTML;
	}

	/**
	 * 更新TOC内容（重建，DOM 遍历路径）
	 */
	public updateTOCContent(): void {
		const tocContent = document.getElementById(this.contentId);
		if (!tocContent) return;

		tocContent.innerHTML = this.generateTOCHTML();
		this.tocItems = Array.from(
			document.querySelectorAll(`#${this.contentId} a`),
		);
	}

	/**
	 * 目录定位参考线：锚点停靠处距视口顶的距离。由 CSS scroll-margin-top 驱动，
	 * 固定导航栏（5.5rem）与其折叠态（1rem）各自不同，读计算值可自动适配。
	 */
	private getReferenceLine(heading: HTMLElement): number {
		return Number.parseFloat(getComputedStyle(heading).scrollMarginTop) || 0;
	}

	/**
	 * 参与目录定位的正文标题（跳过隐藏的一级标题与无 id 的标题）
	 */
	private getHeadingElements(): HTMLElement[] {
		return this.getAllHeadings().filter(
			(heading) =>
				heading.id && Number.parseInt(heading.tagName.charAt(1), 10) >= 2,
		);
	}

	/**
	 * 每个标题管辖的内容区间
	 */
	private getHeadingSpans(headings: HTMLElement[]): HeadingSpan[] {
		const documentBottom =
			document.documentElement.scrollHeight - window.scrollY;

		return headings.map((heading, index) => {
			const next = headings[index + 1];
			return {
				id: heading.id,
				top: heading.getBoundingClientRect().top,
				bottom: next
					? next.getBoundingClientRect().top
					: documentBottom,
			};
		});
	}

	/**
	 * 活动项（文字与圆点高亮）判定：标题元素自身落在视口内即纳入
	 */
	private getActiveHeadingIds(): string[] {
		const headings = this.getAllHeadings();
		const activeHeadingIds: string[] = [];

		headings.forEach((heading) => {
			// 跳过已隐藏的正文一级标题
			const depth = Number.parseInt(heading.tagName.charAt(1), 10);
			if (depth < 2) return;
			if (heading.id) {
				const rect = heading.getBoundingClientRect();
				const isVisible = rect.top < window.innerHeight && rect.bottom > 0;

				if (isVisible) {
					activeHeadingIds.push(heading.id);
				}
			}
		});

		// 如果没有可见标题，选择最接近屏幕顶部的标题
		if (activeHeadingIds.length === 0 && headings.length > 0) {
			let closestHeading: string | null = null;
			let minDistance = Number.POSITIVE_INFINITY;

			headings.forEach((heading) => {
				const depth = Number.parseInt(heading.tagName.charAt(1), 10);
				if (depth < 2) return;
				if (heading.id) {
					const rect = heading.getBoundingClientRect();
					const distance = Math.abs(rect.top);

					if (distance < minDistance) {
						minDistance = distance;
						closestHeading = heading.id;
					}
				}
			});

			if (closestHeading) {
				activeHeadingIds.push(closestHeading);
			}
		}

		return activeHeadingIds;
	}

	/**
	 * 活动指示器（背景色块）判定：内容落在参考线以下的标题，
	 * 区间与 [参考线, 视口底] 有交集即纳入。区间底部正好压在参考线上视为
	 * 已滚过（无内容残留），从下一个标题开始。
	 */
	private getIndicatorHeadingIds(): string[] {
		const headings = this.getHeadingElements();
		if (headings.length === 0) return [];

		const referenceLine = this.getReferenceLine(headings[0]);
		const spans = this.getHeadingSpans(headings);
		const cutLine = referenceLine + REFERENCE_LINE_TOLERANCE;

		const indicatorHeadingIds = spans
			.filter(
				(span) => span.top < window.innerHeight && span.bottom > cutLine,
			)
			.map((span) => span.id);

		if (indicatorHeadingIds.length > 0) return indicatorHeadingIds;

		const closest = spans.reduce((best, span) =>
			Math.abs(span.top - referenceLine) <
			Math.abs(best.top - referenceLine)
				? span
				: best,
		);

		return [closest.id];
	}

	/**
	 * 按标题ID匹配目录项
	 */
	private matchTocItems(headingIds: string[]): HTMLElement[] {
		return this.tocItems.filter((item) => {
			const headingId = item.dataset.headingId;
			return !!headingId && headingIds.includes(headingId);
		});
	}

	/**
	 * 更新活动状态。活动项与活动指示器各走一套判定，互不牵连
	 */
	public updateActiveState(): void {
		if (!this.tocItems || this.tocItems.length === 0) return;

		// 移除所有活动状态
		this.tocItems.forEach((item) => {
			item.classList.remove("visible");
		});

		const activeItems = this.matchTocItems(this.getActiveHeadingIds());

		// 添加活动状态
		activeItems.forEach((item) => {
			item.classList.add("visible");
		});

		// 更新活动指示器
		this.updateActiveIndicator(
			this.matchTocItems(this.getIndicatorHeadingIds()),
		);
	}

	/**
	 * 更新活动指示器
	 */
	private updateActiveIndicator(activeItems: HTMLElement[]): void {
		const indicator = document.getElementById(this.indicatorId);
		if (!indicator || !this.tocItems.length) return;

		if (activeItems.length === 0) {
			indicator.style.opacity = "0";
			return;
		}

		const tocContent = document.getElementById(this.contentId);
		if (!tocContent) return;

		const contentRect = tocContent.getBoundingClientRect();
		const firstActive = activeItems[0];
		const lastActive = activeItems[activeItems.length - 1];

		const firstRect = firstActive.getBoundingClientRect();
		const lastRect = lastActive.getBoundingClientRect();

		const top = firstRect.top - contentRect.top;
		const height = lastRect.bottom - firstRect.top;

		indicator.style.top = `${top}px`;
		indicator.style.height = `${height}px`;
		indicator.style.opacity = "1";

		// 自动滚动到活动项
		if (firstActive) {
			this.scrollToActiveItem(firstActive);
		}
	}

	/**
	 * 滚动到活动项
	 */
	private scrollToActiveItem(activeItem: HTMLElement): void {
		if (!activeItem) return;

		const tocContainer = document
			.querySelector(`#${this.contentId}`)
			?.closest(".toc-scroll-container");
		if (!tocContainer) return;

		// 清除之前的定时器
		if (this.scrollTimeout) {
			clearTimeout(this.scrollTimeout);
		}

		// 使用节流机制
		this.scrollTimeout = window.setTimeout(() => {
			const containerRect = tocContainer.getBoundingClientRect();
			const itemRect = activeItem.getBoundingClientRect();

			// 只在元素不在可视区域时才滚动
			const isVisible =
				itemRect.top >= containerRect.top &&
				itemRect.bottom <= containerRect.bottom;

			if (!isVisible) {
				const itemOffsetTop = (activeItem as HTMLElement).offsetTop;
				const containerHeight = tocContainer.clientHeight;
				const itemHeight = activeItem.clientHeight;

				// 计算目标滚动位置，将元素居中显示
				const targetScroll =
					itemOffsetTop - containerHeight / 2 + itemHeight / 2;

				tocContainer.scrollTo({
					top: targetScroll,
					behavior: "smooth",
				});
			}
		}, 100);
	}

	/**
	 * 处理点击事件
	 */
	public handleClick(event: Event): void {
		event.preventDefault();
		const target = event.currentTarget as HTMLAnchorElement;
		const id = decodeURIComponent(
			target.getAttribute("href")?.substring(1) || "",
		);
		const targetElement = document.getElementById(id);

		if (targetElement) {
			const targetTop =
				targetElement.getBoundingClientRect().top +
				window.pageYOffset -
				this.getReferenceLine(targetElement);

			window.scrollTo({
				top: targetTop,
				behavior: "smooth",
			});
		}
	}

	/**
	 * 滚动监听（rAF 节流）。每次滚动帧全量重算活动项。
	 */
	private handleScroll = (): void => {
		if (this.scrollFrame !== null) return;

		this.scrollFrame = requestAnimationFrame(() => {
			this.scrollFrame = null;
			this.updateActiveState();
		});
	};

	/**
	 * 绑定滚动监听
	 */
	public setupScrollListener(): void {
		window.addEventListener("scroll", this.handleScroll, { passive: true });
	}

	/**
	 * 绑定点击事件
	 */
	public bindClickEvents(): void {
		this.tocItems.forEach((item) => {
			item.addEventListener("click", this.handleClick.bind(this));
		});
	}

	/**
	 * 清理
	 */
	public cleanup(): void {
		if (this.scrollTimeout) {
			clearTimeout(this.scrollTimeout);
			this.scrollTimeout = null;
		}
		if (this.scrollFrame !== null) {
			cancelAnimationFrame(this.scrollFrame);
			this.scrollFrame = null;
		}
		window.removeEventListener("scroll", this.handleScroll);
	}

	/**
	 * 重建目录（DOM 遍历生成列表）+ 绑定交互。
	 * 用于 fallback：加密文章解密后、空 SSR、或站内导航后侧栏 DOM 变旧时。
	 */
	public render(): void {
		this.updateTOCContent();
		this.bindClickEvents();
		this.setupScrollListener();
		this.updateActiveState();
	}

	/**
	 * 判断现有锚点是否与当前正文的目录完全一致（避免站内导航后侧栏 DOM 未被
	 * swup 替换、仍显示上一篇目录的情况）。用与 SSR 相同的算法从当前正文算出
	 * 期望 id 序列并逐一比对——不同文章即使共用个别标题名也不会误判。
	 */
	private anchorsMatchCurrentContent(anchors: HTMLElement[]): boolean {
		const expected = computeTocItems(
			this.domHeadingsToInputs(this.getAllHeadings()),
			{ maxLevel: this.maxLevel },
		);
		if (expected.length !== anchors.length) return false;
		return expected.every(
			(item, i) => anchors[i].dataset.headingId === item.headingId,
		);
	}

	/**
	 * 附着到已有的服务端渲染锚点上（不重新生成列表），只绑定滚动高亮/点击。
	 * 若没有 SSR 锚点、或锚点属于上一篇文章（侧栏未被 swup 替换），回退到 render()。
	 */
	public attach(): void {
		const tocContent = document.getElementById(this.contentId);
		if (!tocContent) return;

		const anchors = Array.from(tocContent.querySelectorAll<HTMLElement>("a"));

		// 没有锚点（加密未解密/空）或锚点是上一篇的 → 重建
		if (anchors.length === 0 || !this.anchorsMatchCurrentContent(anchors)) {
			this.render();
			return;
		}

		this.tocItems = anchors;
		this.bindClickEvents();
		this.setupScrollListener();
		this.updateActiveState();
	}

	/**
	 * 初始化（向后兼容别名，等价于 render()）
	 */
	public init(): void {
		this.render();
	}
}

/**
 * 检查是否为文章页面
 */
export function isPostPage(): boolean {
	return window.location.pathname.includes("/posts/");
}
