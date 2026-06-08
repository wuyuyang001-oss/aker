// pack.mjs — 用 @electron/packager 打包成 .app，再压成可下载的 zip
import { packager } from '@electron/packager';
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ARCH = process.arch === 'x64' ? 'x64' : 'arm64';
console.log(`▶ packaging Aker (darwin/${ARCH})`);

const appPaths = await packager({
  dir: '.',
  name: 'Aker',
  platform: 'darwin',
  arch: ARCH,
  out: 'dist-app',
  overwrite: true,
  appBundleId: 'com.aker.desktop',
  appVersion: '0.1.1',
  appCategoryType: 'public.app-category.developer-tools',
  icon: 'build/icon.icns',
  prune: true,                         // 移除 devDeps（aker 零运行时依赖 → 体积小）
  ignore: [/^\/dist($|\/)/, /^\/dist-app($|\/)/, /^\/build-standalone\.mjs/, /aker\.html$/, /\.DS_Store/, /^\/data($|\/)/],
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

// 也放一份 .app 到桌面，双击即用。
// ⚠️ 必须用 ditto（保留 .app 里的符号链接与 Framework 结构）；cpSync 会把符号链接改成绝对路径导致 icudtl.dat 丢失。
const appOnDesktop = join(desktop, 'Aker.app');
if (existsSync(appOnDesktop)) rmSync(appOnDesktop, { recursive: true, force: true });
execSync(`ditto "${appBundle}" "${appOnDesktop}"`, { stdio: 'inherit' });
console.log(`✔ app → ${appOnDesktop}`);
