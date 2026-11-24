import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

// Neither sibling ships a dist, so local runs read their source directly.
// The langchain packages are deduped so the harness source and these tests
// share one copy, because the harness relies on instanceof checks.
export default defineConfig({
  resolve: {
    alias: {
      agentloop: source('../agentloop/src/index.ts'),
      'sportsbook-contracts': source('../sportsbook-contracts/packages/ts/src/index.ts'),
    },
    dedupe: ['@langchain/core', '@langchain/langgraph', 'zod'],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
