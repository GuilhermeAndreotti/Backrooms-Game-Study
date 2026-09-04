import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    esbuild: {
      // Keep console.warn/error (they surface real problems) but strip the
      // chatty logs: several of them sit inside per-frame gameplay paths.
      pure: ['console.log', 'console.debug', 'console.info'],
    },
    build: {
      // The server bundle is emitted to dist/server.cjs, so the client gets its
      // own directory: otherwise express.static would serve the server bundle
      // and its source map to anyone who asked.
      outDir: 'dist/client',
      emptyOutDir: true,
      target: 'es2020',
      sourcemap: false,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          // three.js barely changes between deploys; splitting it out lets
          // returning players reuse the cached copy after a game update.
          manualChunks: {
            three: ['three'],
            react: ['react', 'react-dom'],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify: file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
