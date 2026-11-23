import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

// https://llmstxt.org: an index of the docs as Markdown, by section.
const order = ['sdk', 'cli', 'api', 'self-hosting', 'bindings'];
const titles: Record<string, string> = {
	sdk: 'TypeScript SDK',
	cli: 'ov CLI, ov connect and the GitHub Action',
	api: 'Sync server HTTP API',
	'self-hosting': 'Self-hosting the sync server',
	bindings: 'Rust core bindings (Python, Kotlin/Java, Swift, C++)',
};

// Within a section: top-level pages, then guides/, then reference/ (the sidebar's order)
const subdirs = ['guides', 'reference'];
const rank = (id: string) => {
	const parts = id.split('/');
	return parts.length > 2 ? 1 + subdirs.indexOf(parts[1]) + 1 : 0;
};

export const GET: APIRoute = async ({ site }) => {
	const docs = (await getCollection('docs')).filter((e) => e.body);
	const base = site!.origin;
	const lines = [
		'# OpenVireo Developer',
		'',
		'> Docs for building on OpenVireo, an end-to-end encrypted password manager built on KDBX: the TypeScript SDK (@openvireo/sdk), the ov CLI, the sync server HTTP API and the Rust core bindings. Every page below is Markdown.',
		'',
	];
	for (const section of order) {
		const entries = docs
			.filter((e) => e.id === section || e.id.startsWith(`${section}/`))
			.sort((a, b) => rank(a.id) - rank(b.id) || (a.data.sidebar.order ?? 0) - (b.data.sidebar.order ?? 0) || a.id.localeCompare(b.id));
		if (!entries.length) continue;
		lines.push(`## ${titles[section]}`, '');
		for (const e of entries) lines.push(`- [${e.data.title}](${base}/${e.id}.md)${e.data.description ? `: ${e.data.description}` : ''}`);
		lines.push('');
	}
	lines.push(
		'## Examples',
		'',
		`- [Runnable examples](${base}/guides/examples.md): the code from every guide as runnable programs, one GitHub repo per language`,
		'',
	);
	lines.push('## Optional', '', `- [OpenAPI description](${base}/api/openapi.yaml)`, `- [TypeScript API reference](${base}/sdk/api/)`, '');
	return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
