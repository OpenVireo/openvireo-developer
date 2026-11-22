// Turns consecutive fenced code blocks marked with tab="Label" into one tabbed group:
//
//   ```ts tab="TypeScript"        On GitHub these stay ordinary blocks one after another; here they
//   ...                           become tabs. The reader's choice is remembered and applied to every
//   ```                           group on every page (src/scripts/code-tabs.ts).
//   ```python tab="Python"
//   ...
//   ```
//
// A lone tab="..." block is left as a plain block. Works in .md (no MDX needed): the group is built from
// mdast nodes with data.hName, so Expressive Code still renders each block.

const TAB = /(?:^|\s)tab="([^"]+)"/;

let group = 0;

export default function remarkCodeTabs() {
	return (tree) => visit(tree);
}

function labelOf(node) {
	return node.type === 'code' && node.meta ? TAB.exec(node.meta)?.[1] : undefined;
}

function stripTab(node) {
	node.meta = node.meta.replace(TAB, ' ').trim() || null;
}

function visit(parent) {
	if (!Array.isArray(parent.children)) return;
	const out = [];
	const children = parent.children;
	for (let i = 0; i < children.length; i++) {
		if (!labelOf(children[i])) {
			visit(children[i]);
			out.push(children[i]);
			continue;
		}
		const run = [];
		while (i < children.length && labelOf(children[i])) run.push(children[i++]);
		i--;
		const labels = run.map(labelOf);
		run.forEach(stripTab);
		out.push(run.length === 1 ? run[0] : tabs(run, labels));
	}
	parent.children = out;
}

function tabs(blocks, labels) {
	const id = `ov-tabs-${++group}`;
	const el = (type, hName, hProperties, children) => ({ type, data: { hName, hProperties }, children });
	const buttons = labels.map((label, i) =>
		el('ovCodeTab', 'button', {
			type: 'button',
			role: 'tab',
			id: `${id}-tab-${i}`,
			ariaSelected: i === 0 ? 'true' : 'false',
			ariaControls: `${id}-panel-${i}`,
			tabIndex: i === 0 ? 0 : -1,
			dataLabel: label,
		}, [{ type: 'text', value: label }]),
	);
	const panels = blocks.map((block, i) =>
		el('ovCodeTabPanel', 'div', {
			role: 'tabpanel',
			id: `${id}-panel-${i}`,
			ariaLabelledBy: `${id}-tab-${i}`,
			dataLabel: labels[i],
			hidden: i !== 0,
		}, [block]),
	);
	return el('ovCodeTabs', 'div', { className: ['ov-code-tabs', 'not-content'] }, [
		el('ovCodeTabList', 'div', { role: 'tablist', className: ['ov-code-tablist'], ariaLabel: 'Language' }, buttons),
		...panels,
	]);
}
