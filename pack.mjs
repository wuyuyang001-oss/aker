// pack.mjs — 用 @electron/packager 打包成 .app，再压成可下载的 zip
import { packager } from '@electron/packager';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ARCH = process.arch === 'x64' ? 'x64' : 'arm64';
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
console.log(`▶ packaging Aker ${version} (darwin/${ARCH})`);

const appPaths = await packager({
  dir: '.',
  name: 'Aker',
  platform: 'darwin',
  arch: ARCH,
  out: 'dist-app',
  overwrite: true,
  appBundleId: 'com.aker.desktop',
  appVersion: version,
  appCategoryType: 'public.app-category.productivity',
  icon: 'build/icon',
  prune: true,                         // 移除 devDeps（aker 零运行时依赖 → 体积小）
  ignore: [
    /^\/dist($|\/)/, /^\/dist-app($|\/)/, /^\/docs($|\/)/, /^\/test($|\/)/,
    /^\/build($|\/)/, /^\/build-standalone\.mjs/, /^\/pack\.mjs/,
    /^\/README\.md/, /^\/package-lock\.json/, /^\/data($|\/)/,
    /aker\.html$/, /\.DS_Store/, /^\/\.git/,
  ],
});

const appDir = appPaths[0];
const appBundle = join(appDir, 'Aker.app');
console.log(`✔ built: ${appBundle}`);

// 复制 .app 到桌面，并打 zip
const desktop = join(process.env.HOME, 'Desktop');
const zipPath = join(desktop, `Aker-mac-${ARCH}.zip`);
if (existsSync(zipPath)) rmSync(zipPath);
execSync(`ditto -c -k --sequesterRsrc --keepParent "${appBundle}" "${zipPath}"`, { stdio: 'inherit' });
console.log(`✔ zip → ${zipPath}`);

const checksum = await sha256(zipPath);
const checksumPath = `${zipPath}.sha256`;
writeFileSync(checksumPath, `${checksum}  ${zipPath.split('/').pop()}\n`);
console.log(`✔ sha256 → ${checksumPath}`);

// 也放一份 .app 到桌面，双击即用。
// ⚠️ 必须用 ditto（保留 .app 里的符号链接与 Framework 结构）；cpSync 会把符号链接改成绝对路径导致 icudtl.dat 丢失。
const appOnDesktop = join(desktop, 'Aker.app');
if (existsSync(appOnDesktop)) rmSync(appOnDesktop, { recursive: true, force: true });
execSync(`ditto "${appBundle}" "${appOnDesktop}"`, { stdio: 'inherit' });
console.log(`✔ app → ${appOnDesktop}`);

function sha256(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}
