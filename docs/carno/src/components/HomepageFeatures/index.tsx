import type { ReactNode } from 'react';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

/* Inline line icons — single stroke, brand-tuned */
function IconLayers() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" />
      <path d="m3 12 9 4.5 9-4.5" />
      <path d="m3 16.5 9 4.5 9-4.5" />
    </svg>
  );
}
function IconSchema() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <ellipse cx="12" cy="5" rx="8" ry="2.5" />
      <path d="M4 5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V5" />
      <path d="M4 11v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" />
    </svg>
  );
}
function IconFlow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="6" height="6" rx="1.5" />
      <rect x="15" y="15" width="6" height="6" rx="1.5" />
      <path d="M9 6h4a2 2 0 0 1 2 2v7" />
      <path d="m13 13 2 2-2 2" />
    </svg>
  );
}
function IconPulse() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12h4l2-7 4 14 2-7h6" />
    </svg>
  );
}
function IconHooks() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="M7.8 7.8 10.5 16" />
      <path d="M16.2 7.8 13.5 16" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

type FeatureItem = {
  title: string;
  icon: ReactNode;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Explicit architecture',
    icon: <IconLayers />,
    description: (
      <>Controllers, services, modules and providers define clear boundaries
      — for codebases that are read more often than they’re written.</>
    ),
  },
  {
    title: 'Type-safe ORM',
    icon: <IconSchema />,
    description: (
      <>PostgreSQL and MySQL with identity map, lazy loading, transactions
      and migrations — typed end‑to‑end, no schema drift.</>
    ),
  },
  {
    title: 'Composable pipeline',
    icon: <IconFlow />,
    description: (
      <>Middleware, guards and interceptors composed declaratively, with
      predictable order and request‑scoped resolution.</>
    ),
  },
  {
    title: 'Operational toolkit',
    icon: <IconPulse />,
    description: (
      <>Background queues with BullMQ, cron scheduling and WebSockets — all
      first‑party, all sharing the same lifecycle and DI.</>
    ),
  },
  {
    title: 'Lifecycle hooks',
    icon: <IconHooks />,
    description: (
      <>Deterministic hooks across application, request and module scopes —
      startup, shutdown and graceful teardown that you can reason about.</>
    ),
  },
  {
    title: 'Built for production',
    icon: <IconShield />,
    description: (
      <>Validation, exception filters, CORS, compression and a testing
      harness — assembled, not glued together from disparate libraries.</>
    ),
  },
];

function Feature({ title, icon, description }: FeatureItem) {
  return (
    <article className={styles.featureCard}>
      <div className={styles.featureIcon}>{icon}</div>
      <Heading as="h3" className={styles.featureTitle}>{title}</Heading>
      <p className={styles.featureDescription}>{description}</p>
    </article>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.head}>
          <span className={styles.eyebrow}>Capabilities</span>
          <Heading as="h2" className={styles.title}>
            What you get on day one.
          </Heading>
          <p className={styles.lede}>
            A coherent set of primitives — not a starter kit, not a thin
            wrapper. Carno.js ships with the building blocks an enterprise
            application actually needs.
          </p>
        </div>
        <div className={styles.grid}>
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
