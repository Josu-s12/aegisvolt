import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo, /graphql se redirige al gateway local (npm run dev).
// En Kubernetes, nginx hace lo mismo hacia el gateway del MISMO namespace/ambiente.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/graphql': process.env.GRAPHQL_PROXY_TARGET || 'http://localhost:4000' },
  },
});
