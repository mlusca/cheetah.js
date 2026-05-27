import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const posthogApiKey = process.env.POSTHOG_API_KEY?.trim();
const posthogAppUrl =
  process.env.POSTHOG_APP_URL?.trim() || 'https://us.i.posthog.com';
const plugins: Config['plugins'] = [];

if (posthogApiKey) {
  plugins.push([
    'posthog-docusaurus',
    {
      apiKey: posthogApiKey,
      appUrl: posthogAppUrl,
      enableInDevelopment: false,
    },
  ]);
}

const config: Config = {
  title: 'Carno.js',
  tagline: 'A TypeScript application framework for Bun — built around explicit architecture.',
  favicon: 'img/carno.png',

  future: {
    v4: true,
  },

  url: 'https://carnojs.github.io',
  baseUrl: '/carno.js/',

  organizationName: 'carnojs',
  projectName: 'carno.js',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  plugins,

  themes: [
    [
      require.resolve("@easyops-cn/docusaurus-search-local"),
      /** @type {import("@easyops-cn/docusaurus-search-local").PluginOptions} */
      ({
        hashed: true,
        language: ["en"],
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
      }),
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/carnojs/carno.js/tree/main/docs/carno/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/carno.png',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Carno.js',
      logo: {
        alt: 'Carno.js Logo',
        src: 'img/carno.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://github.com/carnojs/carno.js',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Introduction',
              to: '/docs/intro',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/carnojs/carno.js',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Carno.js. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
