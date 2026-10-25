import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

const PLACEHOLDER = '<meta name="doocide-csp" />';

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

/** Inner text of every inline <script> or <style> element in the page. */
export function inlineBlocks(html: string, tag: 'script' | 'style'): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  return [...html.matchAll(re)].map((m) => m[1] ?? '').filter((s) => s.length > 0);
}

export function buildPolicy(html: string): string {
  const scripts = inlineBlocks(html, 'script').map(sha256);
  const styles = inlineBlocks(html, 'style').map(sha256);
  return [
    "default-src 'none'",
    `script-src ${scripts.join(' ') || "'none'"}`,
    `style-src ${styles.join(' ') || "'none'"}`,
    "img-src 'self' data:",
    // Language packs and templates only, from the app's own origin.
    "connect-src 'self'",
    // The online page's app manifest and its one service worker (receiving shared files), both its own.
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "require-trusted-types-for 'script'",
  ].join('; ');
}

/**
 * Replaces the placeholder meta tag with a strict Content-Security-Policy whose script and style
 * hashes match the inlined code. Runs after vite-plugin-singlefile has inlined everything.
 */
export function contentSecurityPolicy(): Plugin {
  return {
    name: 'doocide-csp',
    apply: 'build',
    enforce: 'post',
    // vite-plugin-singlefile inlines in a post-ordered generateBundle; this plugin is listed after it,
    // so it runs last and hashes the final inline code.
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        for (const file of Object.values(bundle)) {
          if (file.type !== 'asset' || !file.fileName.endsWith('.html')) continue;
          const html = String(file.source);
          if (!html.includes(PLACEHOLDER)) this.error(`CSP placeholder missing in ${file.fileName}`);
          if (/<script\b[^>]*\bsrc=/.test(html)) this.error(`External script left in ${file.fileName}`);
          const policy = buildPolicy(html);
          file.source = html.replace(PLACEHOLDER, `<meta http-equiv="Content-Security-Policy" content="${policy}" />`);
        }
      },
    },
  };
}
