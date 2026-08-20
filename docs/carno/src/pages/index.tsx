import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import Heading from '@theme/Heading';
import styles from './index.module.css';

/* ---------------------------------------------------------------
 * Hero — editorial split layout
 * Left: eyebrow + display headline (serif italic accent) + sub +
 *       CTA cluster + "trusted on" line
 * Right: code window mock with realistic Carno snippet
 * --------------------------------------------------------------- */
function Hero() {
  return (
    <header className={styles.hero}>
      <div className={styles.heroGrid}>
        <div className={styles.heroCopy}>
          <Heading as="h1" className={styles.headline}>
            The framework for engineers
            <br />
            who plan to&nbsp;
            <span className={styles.headlineAccent}>stay</span>.
          </Heading>

          <p className={styles.lede}>
            Carno.js is a TypeScript application framework for Bun — built around
            explicit architecture, a type-safe ORM, queues, schedules and
            real‑time. Designed for codebases that need to be maintained, not
            just shipped.
          </p>

          <div className={styles.heroCtas}>
            <Link className="button button--primary button--lg" to="/docs/intro">
              Start building
              <span className={styles.arrow} aria-hidden>→</span>
            </Link>
            <Link className="button button--secondary button--lg" to="/docs/core/overview">
              Read the docs
            </Link>
          </div>

          <div className={styles.heroMeta}>
            <span className={styles.heroMetaItem}>
              <code>bun add @carno.js/core</code>
            </span>
            <span className={styles.heroMetaSep} aria-hidden />
            <span className={styles.heroMetaItem}>
              MIT licensed · Open source
            </span>
          </div>
        </div>

        <div className={styles.heroVisual}>
          <CodeWindow />
        </div>
      </div>

      <div className={styles.heroBackdrop} aria-hidden>
        <div className={styles.gridPattern} />
        <div className={styles.glow} />
      </div>
    </header>
  );
}

/* Code window — tabbed, two snippets */
type CodeTab = 'controller' | 'repository';

function CodeWindow() {
  const [tab, setTab] = useState<CodeTab>('controller');
  return (
    <div className={styles.codeWindow}>
      <div className={styles.codeBar}>
        <span className={clsx(styles.codeDot, styles.codeDotRed)} />
        <span className={clsx(styles.codeDot, styles.codeDotYellow)} />
        <span className={clsx(styles.codeDot, styles.codeDotGreen)} />
        <div className={styles.codeTabList} role="tablist">
          <button
            role="tab"
            type="button"
            aria-selected={tab === 'controller'}
            className={clsx(styles.codeTab, tab === 'controller' && styles.codeTabActive)}
            onClick={() => setTab('controller')}
          >
            users.controller.ts
          </button>
          <button
            role="tab"
            type="button"
            aria-selected={tab === 'repository'}
            className={clsx(styles.codeTab, tab === 'repository' && styles.codeTabActive)}
            onClick={() => setTab('repository')}
          >
            user.repository.ts
          </button>
        </div>
      </div>

      {tab === 'controller' ? <ControllerSnippet /> : <RepositorySnippet />}
    </div>
  );
}

function ControllerSnippet() {
  return (
    <pre className={styles.codeBody} aria-label="UsersController example">
      <code>
        <span className={styles.kw}>import</span>{' '}
        <span className={styles.pun}>{'{'}</span> Controller, Get{' '}
        <span className={styles.pun}>{'}'}</span>{' '}
        <span className={styles.kw}>from</span>{' '}
        <span className={styles.str}>'@carno.js/core'</span>
        <span className={styles.pun}>;</span>
        {'\n'}
        <span className={styles.kw}>import</span>{' '}
        <span className={styles.pun}>{'{'}</span> UserRepository{' '}
        <span className={styles.pun}>{'}'}</span>{' '}
        <span className={styles.kw}>from</span>{' '}
        <span className={styles.str}>'../repositories'</span>
        <span className={styles.pun}>;</span>
        {'\n\n'}
        <span className={styles.dec}>@Controller</span>
        <span className={styles.pun}>(</span>
        <span className={styles.str}>'/users'</span>
        <span className={styles.pun}>)</span>
        {'\n'}
        <span className={styles.kw}>export class</span>{' '}
        <span className={styles.cls}>UsersController</span>{' '}
        <span className={styles.pun}>{'{'}</span>
        {'\n  '}
        <span className={styles.kw}>constructor</span>
        <span className={styles.pun}>(</span>
        {'\n    '}
        <span className={styles.kw}>private readonly</span> userRepository
        <span className={styles.pun}>:</span>{' '}
        <span className={styles.cls}>UserRepository</span>
        <span className={styles.pun}>,</span>
        {'\n  '}
        <span className={styles.pun}>{')'}</span>{' '}
        <span className={styles.pun}>{'{}'}</span>
        {'\n\n  '}
        <span className={styles.dec}>@Get</span>
        <span className={styles.pun}>()</span>
        {'\n  '}
        <span className={styles.kw}>async</span>{' '}
        <span className={styles.fn}>listActive</span>
        <span className={styles.pun}>()</span>{' '}
        <span className={styles.pun}>{'{'}</span>
        {'\n    '}
        <span className={styles.kw}>return this</span>
        <span className={styles.pun}>.</span>userRepository
        <span className={styles.pun}>.</span>
        <span className={styles.fn}>findAllByStatus</span>
        <span className={styles.pun}>(</span>
        <span className={styles.str}>'active'</span>
        <span className={styles.pun}>);</span>
        {'\n  '}
        <span className={styles.pun}>{'}'}</span>
        {'\n'}
        <span className={styles.pun}>{'}'}</span>
      </code>
    </pre>
  );
}

function RepositorySnippet() {
  return (
    <pre className={styles.codeBody} aria-label="UserRepository derived methods example">
      <code>
        <span className={styles.kw}>import</span>{' '}
        <span className={styles.pun}>{'{'}</span> Service, Repository{' '}
        <span className={styles.pun}>{'}'}</span>{' '}
        <span className={styles.kw}>from</span>{' '}
        <span className={styles.str}>'@carno.js/orm'</span>
        <span className={styles.pun}>;</span>
        {'\n'}
        <span className={styles.kw}>import</span>{' '}
        <span className={styles.pun}>{'{'}</span> User{' '}
        <span className={styles.pun}>{'}'}</span>{' '}
        <span className={styles.kw}>from</span>{' '}
        <span className={styles.str}>'../entities/user.entity'</span>
        <span className={styles.pun}>;</span>
        {'\n\n'}
        <span className={styles.dec}>@Service</span>
        <span className={styles.pun}>()</span>
        {'\n'}
        <span className={styles.kw}>export class</span>{' '}
        <span className={styles.cls}>UserRepository</span>{' '}
        <span className={styles.kw}>extends</span>{' '}
        <span className={styles.cls}>Repository</span>
        <span className={styles.pun}>{'<'}</span>
        <span className={styles.cls}>User</span>
        <span className={styles.pun}>{'>'}</span>{' '}
        <span className={styles.pun}>{'{'}</span>
        {'\n  '}
        <span className={styles.kw}>constructor</span>
        <span className={styles.pun}>()</span>{' '}
        <span className={styles.pun}>{'{'}</span>{' '}
        <span className={styles.kw}>super</span>
        <span className={styles.pun}>(</span>
        <span className={styles.cls}>User</span>
        <span className={styles.pun}>);</span>{' '}
        <span className={styles.pun}>{'}'}</span>
        {'\n\n  '}
        <span className={styles.cmt}>{'// Derived methods are resolved at runtime'}</span>
        {'\n  '}
        <span className={styles.cmt}>{'// from the method name — no implementation'}</span>
        {'\n  '}
        <span className={styles.cmt}>{'// needed. Call them directly:'}</span>
        {'\n  '}
        <span className={styles.cmt}>{'//   .findByEmail(email)'}</span>
        {'\n  '}
        <span className={styles.cmt}>{'//   .findAllByStatus(status)'}</span>
        {'\n  '}
        <span className={styles.cmt}>{'//   .findAllByStatusAndActive(s, true)'}</span>
        {'\n'}
        <span className={styles.pun}>{'}'}</span>
      </code>
    </pre>
  );
}

/* ---------------------------------------------------------------
 * Pillars stripe — numbered, editorial
 * --------------------------------------------------------------- */
function Pillars() {
  const items = [
    { n: '01', title: 'Explicit architecture',     copy: 'Modules, controllers, services and providers — boundaries you can read.' },
    { n: '02', title: 'Type-safe data layer',      copy: 'A first-party ORM with identity map, lazy loading and transactions.' },
    { n: '03', title: 'Production-ready toolkit',  copy: 'Queues, schedules, WebSockets and CLI — assembled, not glued.' },
    { n: '04', title: 'Lifecycle by design',       copy: 'Deterministic hooks across the app, request and module scopes.' },
  ];
  return (
    <section className={styles.pillars}>
      <div className="container">
        <div className={styles.pillarsGrid}>
          {items.map((it) => (
            <article key={it.n} className={styles.pillarItem}>
              <div className={styles.pillarN}>{it.n}</div>
              <h3 className={styles.pillarTitle}>{it.title}</h3>
              <p className={styles.pillarCopy}>{it.copy}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------
 * Architecture — annotated visual stack
 * --------------------------------------------------------------- */
function Architecture() {
  const stack = [
    { tag: 'Edge',        title: 'HTTP · WebSocket · CLI',     desc: 'Native Bun runtime entrypoints.' },
    { tag: 'Application', title: 'Controllers · Modules · DI', desc: 'Wired through decorators, resolved by the container.' },
    { tag: 'Domain',      title: 'Services · Lifecycle hooks', desc: 'Business logic with deterministic ordering.' },
    { tag: 'Data',        title: 'ORM · Queues · Scheduler',   desc: 'PostgreSQL / MySQL, BullMQ, cron — first‑party.' },
  ];
  return (
    <section className={styles.archSection}>
      <div className="container">
        <div className={styles.sectionHead}>
          <span className={styles.sectionEyebrow}>Architecture</span>
          <Heading as="h2" className={styles.sectionTitle}>
            One framework. <em className={styles.serifEm}>Four layers.</em> Zero glue code.
          </Heading>
          <p className={styles.sectionLede}>
            Carno.js gives every concern a home. The same primitives compose an
            HTTP endpoint, a queue worker, a scheduled job, or a WebSocket
            channel — without leaving the framework.
          </p>
        </div>

        <div className={styles.archStack}>
          {stack.map((row, i) => (
            <div key={row.tag} className={styles.archRow}>
              <div className={styles.archIndex}>{String(i + 1).padStart(2, '0')}</div>
              <div className={styles.archTag}>{row.tag}</div>
              <div className={styles.archTitle}>{row.title}</div>
              <div className={styles.archDesc}>{row.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------
 * Familiar foundations — a discovery bridge for structured-framework
 * developers without defining Carno.js through another framework.
 * --------------------------------------------------------------- */
function FamiliarFoundations() {
  const concepts = [
    { label: 'Modules', value: 'Composable Carno instances' },
    { label: 'Dependencies', value: 'Explicit service registration' },
    { label: 'Scopes', value: 'Singleton · Request · Instance' },
    { label: 'Runtime', value: 'Bun, end to end' },
  ];

  return (
    <section className={styles.foundationSection}>
      <div className="container">
        <div className={styles.foundationCard}>
          <div className={styles.foundationCopy}>
            <span className={styles.sectionEyebrow}>Familiar foundations</span>
            <Heading as="h2" className={styles.foundationTitle}>
              Bring your architectural instincts.
              <br />
              <em className={styles.serifEm}>Leave the runtime behind.</em>
            </Heading>
            <p className={styles.foundationLede}>
              If you have worked with NestJS or Spring, concepts such as
              controllers, services, dependency injection, modules, and
              lifecycle hooks will feel familiar. Carno.js applies those ideas
              through its own Bun-native runtime, application model, and
              first-party ecosystem.
            </p>
            <Link className={styles.foundationLink} to="/docs/coming-from-nestjs">
              Coming from NestJS? Read the guide
              <span className={styles.arrow} aria-hidden>→</span>
            </Link>
          </div>

          <div className={styles.foundationMap} aria-label="Carno.js architecture concepts">
            <div className={styles.foundationMapHead}>
              <span>Concept</span>
              <span>Carno.js model</span>
            </div>
            {concepts.map((concept) => (
              <div className={styles.foundationMapRow} key={concept.label}>
                <span className={styles.foundationMapLabel}>{concept.label}</span>
                <span className={styles.foundationMapValue}>{concept.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------
 * Install — refined tabs
 * --------------------------------------------------------------- */
function Install() {
  const [pkg, setPkg] = useState<'core' | 'orm' | 'queue'>('core');
  const cmd: Record<typeof pkg, string> = {
    core:  'bun add @carno.js/core',
    orm:   'bun add @carno.js/orm',
    queue: 'bun add @carno.js/queue',
  };
  return (
    <section className={styles.installSection}>
      <div className="container">
        <div className={styles.installHead}>
          <span className={styles.sectionEyebrow}>Install</span>
          <Heading as="h2" className={styles.sectionTitle}>
            Add what you need. <em className={styles.serifEm}>Nothing more.</em>
          </Heading>
        </div>

        <div className={styles.installCard}>
          <div className={styles.installTabs} role="tablist" aria-label="Package">
            {(['core', 'orm', 'queue'] as const).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={pkg === k}
                type="button"
                className={clsx(styles.installTab, pkg === k && styles.installTabActive)}
                onClick={() => setPkg(k)}
              >
                @carno.js/{k}
              </button>
            ))}
          </div>
          <div className={styles.installCmd}>
            <span className={styles.installPrompt}>$</span>
            <code>{cmd[pkg]}</code>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------
 * Closing CTA — the killer
 * Full-bleed dark band, editorial typography.
 * --------------------------------------------------------------- */
function ClosingCta() {
  return (
    <section className={styles.cta}>
      <div className={styles.ctaInner}>
        <span className={styles.ctaEyebrow}>Ready when you are</span>
        <Heading as="h2" className={styles.ctaHeadline}>
          Write the codebase
          <br />
          <em className={styles.ctaSerif}>you’d want to inherit.</em>
        </Heading>
        <p className={styles.ctaLede}>
          A framework you’ll still recognize in three years — because the
          architecture was the point, not an afterthought.
        </p>
        <div className={styles.ctaActions}>
          <Link className={clsx('button button--lg', styles.ctaPrimary)} to="/docs/intro">
            Get started
            <span className={styles.arrow} aria-hidden>→</span>
          </Link>
          <Link className={clsx('button button--lg', styles.ctaGhost)} to="https://github.com/carnojs/carno.js">
            View on GitHub
          </Link>
        </div>
        <div className={styles.ctaFootnote}>
          Open source · MIT · Built on Bun + TypeScript
        </div>
      </div>
      <div className={styles.ctaGrid} aria-hidden />
    </section>
  );
}

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} — Enterprise framework for Bun`}
      description="Carno.js: a TypeScript application framework for Bun. Explicit architecture, type-safe ORM, queues, schedules and real-time — built to last."
    >
      <Hero />
      <main>
        <Pillars />
        <HomepageFeatures />
        <Architecture />
        <FamiliarFoundations />
        <Install />
        <ClosingCta />
      </main>
    </Layout>
  );
}
