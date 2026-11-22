// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import remarkCodeTabs from './src/plugins/remark-code-tabs.mjs';

// The product sections. Each one is a top-level sidebar group; the Sidebar override shows only the
// group for the section you are in, and the Header override links to each section's landing page.
export default defineConfig({
	site: 'https://developer.openvireo.com',
	trailingSlash: 'always',
	markdown: { remarkPlugins: [remarkCodeTabs] },
	integrations: [
		starlight({
			title: 'OpenVireo Developer',
			description: 'Docs for the OpenVireo SDK, the ov CLI, the sync server API and the Rust core bindings.',
			logo: { src: './src/assets/logo.svg', alt: 'OpenVireo' },
			favicon: '/favicon.svg',
			head: [{ tag: 'link', attrs: { rel: 'icon', href: '/favicon.ico', sizes: '32x32' } }],
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/openvireo' }],
			customCss: [
				'@fontsource-variable/inter',
				'@fontsource-variable/jetbrains-mono',
				'./src/styles/theme.css',
			],
			components: {
				Header: './src/components/Header.astro',
				Sidebar: './src/components/Sidebar.astro',
				PageTitle: './src/components/PageTitle.astro',
			},
			expressiveCode: {
				themes: ['vitesse-dark', 'vitesse-light'],
				styleOverrides: {
					borderRadius: '0.75rem',
					borderColor: 'var(--ov-border)',
					codeFontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
					codeFontSize: '0.8125rem',
					codeLineHeight: '1.75',
					uiFontFamily: "'Inter Variable', system-ui, sans-serif",
					frames: {
						frameBoxShadowCssValue: 'none',
						editorActiveTabIndicatorTopColor: 'var(--ov-accent-text)',
					},
				},
			},
			editLink: { baseUrl: 'https://github.com/openvireo/openvireo-developer/edit/develop/' },
			lastUpdated: false,
			credits: false,
			sidebar: [
				{
					label: 'Guides',
					items: [{ label: 'All guides', link: '/guides/' }],
				},
				{
					label: 'SDK',
					items: [
						{ label: 'Overview', link: '/sdk/' },
						{ label: 'Concepts', link: '/sdk/concepts/' },
						{ label: 'Guides', items: [{ autogenerate: { directory: 'sdk/guides' } }] },
						{ label: 'Reference', items: [{ autogenerate: { directory: 'sdk/reference' } }] },
						{ label: 'TypeScript API', link: '/sdk/api/', attrs: { target: '_self' } },
					],
				},
				{
					label: 'CLI',
					items: [{ autogenerate: { directory: 'cli' } }],
				},
				{
					label: 'API',
					items: [
						{ label: 'Overview', link: '/api/' },
						{ label: 'Reference', link: '/api/reference/' },
						// A full URL: Starlight would add a trailing slash to a path (trailingSlash: 'always')
						{ label: 'openapi.yaml', link: 'https://developer.openvireo.com/api/openapi.yaml' },
					],
				},
				{
					label: 'Self-hosting',
					items: [{ autogenerate: { directory: 'self-hosting' } }],
				},
				{
					label: 'Bindings',
					items: [{ autogenerate: { directory: 'bindings' } }],
				},
			],
		}),
	],
});
