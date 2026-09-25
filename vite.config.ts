import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';

/**
 * index.html carries the AdSense account meta tag and loader script (Google's
 * site verification reads them from the raw HTML) with a %VITE_ADSENSE_CLIENT%
 * placeholder. Vite leaves an undefined placeholder as literal text, and
 * adsbygoogle.js then throws "URIError: URI malformed" decoding "%VI...". So
 * without a configured client, both tags are dropped instead — no ads, as
 * .env.example promises. Runs before Vite's own %ENV% substitution.
 */
function adsenseHtml(client: string | undefined): Plugin {
  return {
    name: 'adsense-html',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (client) return html;
        return html
          .replace(/[ \t]*<meta\s+name="google-adsense-account"[^>]*>\n?/, '')
          .replace(/[ \t]*<script\b[^>]*adsbygoogle\.js[^>]*>\s*<\/script>\n?/, '');
      },
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), tailwindcss(), adsenseHtml(env.VITE_ADSENSE_CLIENT?.trim())],
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
