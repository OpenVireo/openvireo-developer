/**
 * The product sections, in header order. `group` is the sidebar group label in astro.config.mjs. `inHeader:
 * false` keeps a section out of the header nav (the version pill links the changelog); the mobile menu lists all.
 */
export const sections = [
	{ label: 'Guides', href: '/guides/', group: 'Guides' },
	{ label: 'SDK', href: '/sdk/', group: 'SDK' },
	{ label: 'CLI', href: '/cli/', group: 'CLI' },
	{ label: 'API', href: '/api/', group: 'API' },
	{ label: 'Self-hosting', href: '/self-hosting/', group: 'Self-hosting' },
	{ label: 'Bindings', href: '/bindings/', group: 'Bindings' },
	{ label: 'Reference', href: '/reference/', group: 'Reference' },
	{ label: 'Changelog', href: '/changelog/', group: 'Changelog', inHeader: false },
] as const;

export type Section = (typeof sections)[number];

/** The section a path belongs to, by its first segment. */
export function sectionFor(pathname: string): Section | undefined {
	const first = pathname.split('/').filter(Boolean)[0];
	return sections.find((s) => s.href === `/${first}/`);
}
