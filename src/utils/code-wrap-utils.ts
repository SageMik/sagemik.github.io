const STORAGE_KEY = "code_wrap";

const wrapIcons = `<svg class="ff-icon-off" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M16 7H3V5h13zM3 19h13v-2H3zm19-7l-4-3v2H3v2h15v2z"/></svg><svg class="ff-icon-on" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M21 5H3v2h18zM3 19h7v-2H3zm0-6h15c1 0 2 .43 2 2s-1 2-2 2h-2v-2l-4 3l4 3v-2h2c2.95 0 4-1.27 4-4c0-2.72-1-4-4-4H3z"/></svg>`;
const expandIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9"/>
  </svg>`;

type CodeTexts = {
	copy: string;
	copied: string;
	wrapEnable: string;
	wrapDisable: string;
	expand: string;
	collapse: string;
};

const texts: CodeTexts = {
	copy: "Copy code",
	copied: "Copied",
	wrapEnable: "Enable word wrap",
	wrapDisable: "Disable word wrap",
	expand: "Expand",
	collapse: "Collapse",
};

let wrapEnabled = false;

function readTexts(): void {
	const raw = document.getElementById("config-carrier")?.dataset.codeTexts;
	if (!raw) return;
	try {
		Object.assign(texts, JSON.parse(raw) as Partial<CodeTexts>);
	} catch {}
}

function applyWrapState(wrapped: boolean): void {
	const label = wrapped ? texts.wrapDisable : texts.wrapEnable;
	document
		.querySelectorAll<HTMLElement>(".expressive-code pre")
		.forEach((pre) => {
			pre.classList.toggle("wrap", wrapped);
		});
	document
		.querySelectorAll<HTMLButtonElement>(".ff-code-wrap-btn")
		.forEach((btn) => {
			btn.classList.toggle("is-wrapped", wrapped);
			btn.title = label;
			btn.setAttribute("aria-label", label);
		});
}

function applyCopyTexts(): void {
	document
		.querySelectorAll<HTMLButtonElement>(".expressive-code .frame .copy button")
		.forEach((btn) => {
			btn.title = texts.copy;
			btn.dataset.copied = texts.copied;
			btn.setAttribute("aria-label", texts.copy);
		});
}

function createExpandButton(
	collapse: HTMLElement,
	toggle: HTMLButtonElement,
): HTMLButtonElement {
	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = "ff-code-expand-btn";
	btn.innerHTML = expandIcon;
	btn.addEventListener("click", () => toggle.click());

	const sync = () => {
		const expanded = collapse.classList.contains("ec-collapse--expanded");
		const label = expanded ? texts.collapse : texts.expand;
		btn.title = label;
		btn.setAttribute("aria-label", label);
		btn.setAttribute("aria-expanded", String(expanded));
	};
	new MutationObserver(sync).observe(collapse, {
		attributes: true,
		attributeFilter: ["class"],
	});
	sync();
	return btn;
}

function injectButtons(): void {
	document
		.querySelectorAll<HTMLElement>(
			".expressive-code figure.frame:not(.has-title)",
		)
		.forEach((frame) => {
			if (!frame.querySelector(".ff-code-wrap-btn")) {
				const wrapBtn = document.createElement("button");
				wrapBtn.type = "button";
				wrapBtn.className = "ff-code-wrap-btn";
				wrapBtn.innerHTML = wrapIcons;
				frame.appendChild(wrapBtn);
			}

			const collapse = frame.closest<HTMLElement>(".ec-collapse");
			const toggle = collapse?.querySelector<HTMLButtonElement>(
				".ec-collapse__toggle",
			);
			if (
				collapse &&
				toggle &&
				!collapse.querySelector(".ff-code-expand-btn")
			) {
				frame.appendChild(createExpandButton(collapse, toggle));
			}
		});
}

export function initCodeWrapToggle(): void {
	try {
		wrapEnabled = localStorage.getItem(STORAGE_KEY) === "1";
	} catch {}

	readTexts();

	const refresh = () => {
		injectButtons();
		applyWrapState(wrapEnabled);
		applyCopyTexts();
	};
	refresh();

	document.addEventListener("click", (event) => {
		const target = event.target as Element | null;
		if (!target?.closest?.(".ff-code-wrap-btn")) return;
		wrapEnabled = !wrapEnabled;
		try {
			localStorage.setItem(STORAGE_KEY, wrapEnabled ? "1" : "0");
		} catch {}
		applyWrapState(wrapEnabled);
	});

	document.addEventListener("swup:contentReplaced", refresh);
	document.addEventListener("astro:page-load", refresh);
}
