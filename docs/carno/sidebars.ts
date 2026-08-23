import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    {
      type: 'category',
      label: 'Getting Started',
      items: ['intro', 'installation', 'coming-from-nestjs', 'cli'],
    },
    {
      type: 'category',
      label: 'Core',
      items: [
        'core/overview',
        'core/controllers',
        'core/context',
        'core/validation',
        'core/dependency-injection',
        'core/middleware',
        'core/logging',
        'core/caching',
        'core/lifecycle',
      ],
    },
    {
      type: 'category',
      label: 'ORM',
      items: [
        'orm/overview',
        'orm/entities',
        'orm/relations',
        'orm/repository',
        'orm/pagination',
        'orm/derived-query-methods',
        'orm/active-record',
        'orm/query-builder',
        'orm/querying',
        'orm/transactions',
        'orm/optimistic-locking',
        'orm/tenant-isolation',
        'orm/read-replicas',
        'orm/caching',
        'orm/identity-map',
        'orm/ref',
        'orm/value-objects',
        'orm/migrations',
        'orm/bulk-operations',
        'orm/session',
      ],
    },
    {
      type: 'category',
      label: 'Queue',
      items: ['queue/overview'],
    },
    {
      type: 'category',
      label: 'Schedule',
      items: ['schedule/overview'],
    },
    {
      type: 'category',
      label: 'Static Files',
      items: ['static/overview'],
    },
    {
      type: 'category',
      label: 'Views',
      items: ['views/overview'],
    },
    {
      type: 'category',
      label: 'WebSocket',
      items: ['websocket/overview'],
    },
    {
      type: 'category',
      label: 'HTTP Client',
      items: [
        'client/overview',
        'client/plugin',
        'client/codegen',
        'client/http',
        'client/generation',
      ],
    },
    {
      type: 'category',
      label: 'Testing',
      items: ['testing/overview'],
    },
    {
      type: 'category',
      label: 'Community',
      items: ['community/plugins'],
    },
  ],
};

export default sidebars;
