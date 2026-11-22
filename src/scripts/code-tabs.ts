// Tabbed code groups from remark-code-tabs: picking a language switches every group that has it, on this page
// and later ones (localStorage), like Starlight's synced <Tabs>.
const KEY = 'ov-code-lang';

function select(group: Element, label: string, focus = false): boolean {
	const tabs = [...group.querySelectorAll<HTMLButtonElement>(':scope > [role="tablist"] > [role="tab"]')];
	const target = tabs.find((t) => t.dataset.label === label);
	if (!target) return false;
	for (const tab of tabs) {
		const on = tab === target;
		tab.setAttribute('aria-selected', String(on));
		tab.tabIndex = on ? 0 : -1;
		const panel = document.getElementById(tab.getAttribute('aria-controls')!);
		if (panel) panel.hidden = !on;
	}
	if (focus) target.focus();
	return true;
}

function selectEverywhere(label: string, origin?: Element) {
	// Keep the clicked group where it is on screen while others above it change height
	const before = origin?.getBoundingClientRect().top;
	for (const group of document.querySelectorAll('.ov-code-tabs')) select(group, label);
	if (origin && before !== undefined) window.scrollBy(0, origin.getBoundingClientRect().top - before);
	try {
		localStorage.setItem(KEY, label);
	} catch {}
}

function init() {
	let stored: string | null = null;
	try {
		stored = localStorage.getItem(KEY);
	} catch {}
	for (const group of document.querySelectorAll('.ov-code-tabs')) {
		if (stored) select(group, stored);
		const list = group.querySelector(':scope > [role="tablist"]')!;
		list.addEventListener('click', (e) => {
			const tab = (e.target as Element).closest<HTMLButtonElement>('[role="tab"]');
			if (tab?.dataset.label) selectEverywhere(tab.dataset.label, group);
		});
		list.addEventListener('keydown', (e) => {
			const ev = e as KeyboardEvent;
			const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
			const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
			if (i < 0) return;
			const next =
				ev.key === 'ArrowRight' ? (i + 1) % tabs.length
				: ev.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length
				: ev.key === 'Home' ? 0
				: ev.key === 'End' ? tabs.length - 1
				: -1;
			if (next < 0) return;
			ev.preventDefault();
			select(group, tabs[next]!.dataset.label!, true);
			selectEverywhere(tabs[next]!.dataset.label!, group);
		});
	}
}

init();
