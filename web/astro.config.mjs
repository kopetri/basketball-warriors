import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// Server-rendered: every request reads fresh data from Postgres (see docs/architecture.md).
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { host: true, port: 4321 },
});
