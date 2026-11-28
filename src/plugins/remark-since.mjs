// Turns version notes in the source docs into badges:
//
//   ## Custom icons (added in SDK 1.1)        On GitHub the note reads as plain text; here it becomes a
//   ... `customIconPng` (added in 1.1) ...    small "Added in SDK 1.1" pill. Also "changed in" and
//                                             "deprecated in"; the product word (SDK, core, sync server)
//                                             is optional.
//
// The badge is a raw HTML node, which Astro leaves out of heading ids and the table of contents, so adding
// a note to a heading doesn't change its #anchor.

const NOTE = /\s*\((added|changed|deprecated) in ((?:SDK|core|sync server) )?(\d+\.\d+(?:\.\d+)?)\)/gi;

export default function remarkSince() {
	return (tree) => walk(tree);
}

function walk(parent) {
	if (!Array.isArray(parent.children)) return;
	for (let i = 0; i < parent.children.length; i++) {
		const node = parent.children[i];
		if (node.type === 'text' && NOTE.test(node.value)) {
			NOTE.lastIndex = 0;
			const parts = split(node.value);
			parent.children.splice(i, 1, ...parts);
			i += parts.length - 1;
			continue;
		}
		// Not inside code, links or existing HTML
		if (node.type !== 'code' && node.type !== 'inlineCode' && node.type !== 'link') walk(node);
	}
}

function split(value) {
	const out = [];
	let last = 0;
	for (const m of value.matchAll(NOTE)) {
		const before = value.slice(last, m.index);
		if (before) out.push({ type: 'text', value: before });
		const kind = m[1].toLowerCase();
		const label = `${kind[0].toUpperCase()}${kind.slice(1)} in ${m[2] ?? ''}${m[3]}`;
		// The space goes inside the HTML, so a heading's text (and its slug) has no trailing space
		out.push({ type: 'html', value: ` <span class="ov-since ov-since-${kind}">${label}</span>` });
		last = m.index + m[0].length;
	}
	const rest = value.slice(last);
	if (rest) out.push({ type: 'text', value: rest });
	return out;
}
