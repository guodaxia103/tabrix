import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { config } from 'dotenv';
import { resolve } from 'path';
import Icons from 'unplugin-icons/vite';
import Components from 'unplugin-vue-components/vite';
import IconsResolver from 'unplugin-icons/resolver';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local') });

// Stable public key to keep unpacked-extension ID deterministic across releases.
// Users can override with CHROME_EXTENSION_KEY for private forks.
const STABLE_CHROME_EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmYqyu+BGtkm1Qysyb15q2TjlCD9ETEdm0leWHFfKgNwYP7zvwtVghPpSj5gXnJnxCYW+w3LmMJ4hBZm6IKQ/sg9IzBGELo/NAK+2FDjPyhjRlTC+bx8zMJueatht1XaJylIbc0qy3xIvASPydkYIlhWQwk9JjvQnhsGt6y0M9Bbhr9I8WXntS0M7+31paPDiIvtkcha0M6i6yfFGaN34BeBTu2ELhBP3/48XcJEjz13NTQfAtmu5n/+303Cs9BM50ZX+scenCJn4GxdiEEyvnsouFL8gsE9aUmJlhCtjl0cALFYosCCtIIsmAWyTS0KhGGPmKnQQKNWfSIu4A90UzQIDAQAB';
const CHROME_EXTENSION_KEY = process.env.CHROME_EXTENSION_KEY || STABLE_CHROME_EXTENSION_KEY;
// Detect dev mode early for manifest-level switches
const IS_DEV = process.env.NODE_ENV !== 'production' && process.env.MODE !== 'production';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  webExt: {
    // 方案1: 禁用自动启动（推荐）
    disabled: true,

    // 方案2: 如果要启用自动启动并使用现有配置，取消注释下面的配置
    // chromiumArgs: [
    //   '--user-data-dir=' + homedir() + (process.platform === 'darwin'
    //     ? '/Library/Application Support/Google/Chrome'
    //     : process.platform === 'win32'
    //     ? '/AppData/Local/Google/Chrome/User Data'
    //     : '/.config/google-chrome'),
    //   '--remote-debugging-port=9222',
    // ],
  },
  manifest: {
    // Stable by default; override via CHROME_EXTENSION_KEY for custom forks.
    key: CHROME_EXTENSION_KEY,
    minimum_chrome_version: '120',
    default_locale: 'zh_CN',
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    permissions: [
      'nativeMessaging',
      'tabs',
      'activeTab',
      'scripting',
      'contextMenus',
      'downloads',
      'webRequest',
      'webNavigation',
      'debugger',
      'history',
      'bookmarks',
      'offscreen',
      'storage',
      'declarativeNetRequest',
      'alarms',
      // Allow programmatic control of Chrome Side Panel
      'sidePanel',
    ],
    host_permissions: ['<all_urls>'],
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
    action: {
      default_popup: 'popup.html',
      default_title: 'Tabrix',
    },
    // Chrome Side Panel hosts the MKEP Memory/Knowledge/Experience viewers.
    // Ref: https://developer.chrome.com/docs/extensions/reference/api/sidePanel
    side_panel: {
      default_path: 'sidepanel.html',
    },
    web_accessible_resources: [
      {
        resources: [
          '/models/*', // 允许访问 public/models/ 下的所有文件
          '/workers/*', // 允许访问 workers 文件
          '/inject-scripts/*', // 允许内容脚本注入的助手文件
        ],
        matches: ['<all_urls>'],
      },
    ],
    // 注意：以下安全策略在开发环境会阻断 dev server 的资源加载，
    // 只在生产环境启用，开发环境交由 WXT 默认策略处理。
    ...(IS_DEV
      ? {}
      : {
          cross_origin_embedder_policy: { value: 'require-corp' as const },
          cross_origin_opener_policy: { value: 'same-origin' as const },
          content_security_policy: {
            // Allow inline styles injected by Vite (compiled CSS) and data images used in UI thumbnails
            extension_pages:
              "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*;",
          },
        }),
  },
  vite: (env) => ({
    plugins: [
      // @protobufjs/inquire uses eval("require") which violates Chrome MV3 CSP.
      // Strip the eval call at build time so the function just returns null.
      {
        name: 'strip-protobufjs-eval',
        transform(code, id) {
          if (id.includes('inquire') || code.includes('eval("quire".replace')) {
            return code.replace(
              /eval\("quire"\.replace\(\/\^\/,\s*"re"\)\)/g,
              '(function(){return null})',
            );
          }
        },
      },
      {
        name: 'sanitize-markstream-deep-selectors',
        transform(code, id) {
          if (!id.includes('markstream-vue') || !id.endsWith('.css') || !code.includes(':deep(')) {
            return;
          }

          // markstream-vue ships one global CSS rule that still contains Vue-only :deep()
          // syntax. Unwrap it during bundling so Lightning CSS can minify production builds
          // without warning, while preserving the intended descendant selectors.
          return code.replace(/:deep\(([^()]+)\)/g, '$1');
        },
      },
      // TailwindCSS v4 Vite plugin – no PostCSS config required
      tailwindcss(),
      // Auto-register SVG icons as Vue components; all icons are bundled locally
      Components({
        dts: false,
        resolvers: [IconsResolver({ prefix: 'i', enabledCollections: ['lucide', 'mdi', 'ri'] })],
      }) as any,
      Icons({ compiler: 'vue3', autoInstall: false }) as any,
      // Ensure static assets are available as early as possible to avoid race conditions in dev
      // Copy workers/_locales/inject-scripts into the build output before other steps
      viteStaticCopy({
        targets: [
          {
            src: 'inject-scripts/*.js',
            dest: 'inject-scripts',
          },
          {
            src: ['workers/*'],
            dest: 'workers',
          },
          {
            src: '_locales/**/*',
            dest: '_locales',
          },
        ],
        // Use writeBundle so outDir exists for dev and prod
        hook: 'writeBundle',
        // Enable watch so changes to these files are reflected during dev
        watch: {
          // Use default patterns inferred from targets; explicit true enables watching
          // Vite plugin will watch src patterns and re-copy on change
        } as any,
      }) as any,
    ],
    build: {
      // Chrome 120+ fully supports BigInt and modern syntax used by bundled deps.
      target: 'es2022',
      // 非生产环境下生成sourcemap
      sourcemap: env.mode !== 'production',
      // Keep production build logs focused on actionable warnings.
      rolldownOptions:
        env.mode === 'production'
          ? {
              checks: {
                pluginTimings: false,
              },
            }
          : undefined,
      // 禁用gzip 压缩大小报告，因为压缩大型文件可能会很慢
      reportCompressedSize: false,
      // chunk大小超过1500kb时触发警告
      chunkSizeWarningLimit: 1500,
      // Keep dev bundles readable while shrinking production output.
      minify: env.mode === 'production' ? 'esbuild' : false,
    },
  }),
});
