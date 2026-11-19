// 历史打包草稿，当前发布不调用；桌面使用 build-sidecar.mjs + asset-versions.mjs。
/**
 * esbuild 配置文件
 * 用于构建 art-canvas 前端资源
 */

export default {
  entryPoints: [
    'static/js/canvas.js',
    'static/js/smart-canvas.js',
    'static/js/canvas-list.js',
    'static/modules/canvas-engine.js',
    'static/modules/auth-token.js',
    'static/i18n.js',
    'static/image-preview.js',
  ],
  outdir: 'static/dist',
  bundle: true,
  splitting: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  treeShaking: true,
  drop: ['console', 'debugger'],
  define: {
    'process.env.NODE_ENV': '"production"'
  },
  external: ['/static/vendor/*'],
};