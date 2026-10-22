import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const srcDir = 'static';
const outDir = 'static/dist';

// 扫描 static 目录下的所有 JS 文件（排除 vendor、node_modules、已构建文件）
function findEntryPoints() {
  const glob = require('child_process').execSync(`
    cd ${srcDir} && find . -name '*.js' -not -path './vendor/*' -not -path './dist/*' -not -path '*/__pycache__/*' | sort
  `).toString().trim().split('\n').filter(Boolean);
  
  return glob.map(f => ({
    name: f.replace('.js', ''),
    path: join('.', f)
  }));
}

async function main() {
  console.log('🔧 Building with esbuild...');
  
  // 清理输出目录
  if (existsSync(outDir)) {
    const { execSync } = require('child_process');
    execSync(`rm -rf ${outDir}`);
  }
  
  // 构建
  const result = await build({
    entryPoints: findEntryPoints().map(e => e.path),
    outdir: outDir,
    bundle: true,
    splitting: true,
    format: 'esm',
    target: 'es2022',
    minify: true,
    sourcemap: true,
    treeShaking: true,
    drop: ['console', 'debugger'],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production')
    },
    external: ['/static/vendor/*'],
    logLevel: 'info',
  });
  
  // 生成 manifest
  const manifest = {};
  for (const file of result.metafile?.outputs || []) {
    const originalPath = file.inputs ? Object.keys(file.inputs)[0] : '';
    if (!originalPath) continue;
    
    // 映射回原始文件名
    const match = originalPath.match(/(.+)\.js$/);
    if (match) {
      const name = match[1].replace('.js', '').replace(/\.js$/, '');
      manifest[name] = `dist/${file.path}`;
    }
  }
  
  // 写入 manifest
  const manifestPath = join(srcDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('📦 Manifest saved to', manifestPath);
  
  // 输出统计
  const totalSize = Object.values(result.metafile.outputs).reduce((sum, v) => sum + v.bytes, 0);
  console.log(`✅ Build complete! Total output size: ${(totalSize / 1024).toFixed(2)} KB`);
}

main().catch(e => {
  console.error('❌ Build failed:', e.message);
  process.exit(1);
});