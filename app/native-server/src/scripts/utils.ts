import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { promisify } from 'util';
import { COMMAND_NAME, DESCRIPTION, EXTENSION_ID, HOST_NAME } from './constant';
import { BrowserType, getBrowserConfig, detectInstalledBrowsers } from './browser-config';
import { resolveAndPersistBrowserLaunchConfig } from '../browser-launch-config';

export const access = promisify(fs.access);
export const mkdir = promisify(fs.mkdir);
export const writeFile = promisify(fs.writeFile);

export interface DetectedExtensionOrigin {
  browser: BrowserType;
  id: string;
  path: string;
  securePreferencesPath: string;
}

/**
 * Get the log directory path for wrapper scripts.
 * Uses platform-appropriate user directories to avoid permission issues.
 *
 * - macOS: ~/Library/Logs/tabrix
 * - Windows: %LOCALAPPDATA%/tabrix/logs
 * - Linux: $XDG_STATE_HOME/tabrix/logs or ~/.local/state/tabrix/logs
 */
export function getLogDir(): string {
  const homedir = os.homedir();

  if (os.platform() === 'darwin') {
    return path.join(homedir, 'Library', 'Logs', 'tabrix');
  } else if (os.platform() === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA || path.join(homedir, 'AppData', 'Local'),
      'tabrix',
      'logs',
    );
  } else {
    // Linux: XDG_STATE_HOME or ~/.local/state
    const xdgState = process.env.XDG_STATE_HOME || path.join(homedir, '.local', 'state');
    return path.join(xdgState, 'tabrix', 'logs');
  }
}

/**
 * 打印彩色文本
 */
export function colorText(text: string, color: string): string {
  const colors: Record<string, string> = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m',
  };

  return colors[color] + text + colors.reset;
}

/**
 * Get user-level manifest file path
 */
export function getUserManifestPath(): string {
  if (os.platform() === 'win32') {
    // Windows: %APPDATA%\Google\Chrome\NativeMessagingHosts\
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'Google',
      'Chrome',
      'NativeMessagingHosts',
      `${HOST_NAME}.json`,
    );
  } else if (os.platform() === 'darwin') {
    // macOS: ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Google',
      'Chrome',
      'NativeMessagingHosts',
      `${HOST_NAME}.json`,
    );
  } else {
    // Linux: ~/.config/google-chrome/NativeMessagingHosts/
    return path.join(
      os.homedir(),
      '.config',
      'google-chrome',
      'NativeMessagingHosts',
      `${HOST_NAME}.json`,
    );
  }
}

/**
 * Get system-level manifest file path
 */
export function getSystemManifestPath(): string {
  if (os.platform() === 'win32') {
    // Windows: %ProgramFiles%\Google\Chrome\NativeMessagingHosts\
    return path.join(
      process.env.ProgramFiles || 'C:\\Program Files',
      'Google',
      'Chrome',
      'NativeMessagingHosts',
      `${HOST_NAME}.json`,
    );
  } else if (os.platform() === 'darwin') {
    // macOS: /Library/Google/Chrome/NativeMessagingHosts/
    return path.join('/Library', 'Google', 'Chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`);
  } else {
    // Linux: /etc/opt/chrome/native-messaging-hosts/
    return path.join('/etc', 'opt', 'chrome', 'native-messaging-hosts', `${HOST_NAME}.json`);
  }
}

/**
 * Get native host startup script file path
 */
export async function getMainPath(): Promise<string> {
  try {
    const packageDistDir = path.join(__dirname, '..');
    const wrapperScriptName = process.platform === 'win32' ? 'run_host.bat' : 'run_host.sh';
    const absoluteWrapperPath = path.resolve(packageDistDir, wrapperScriptName);
    return absoluteWrapperPath;
  } catch (error) {
    console.log(colorText('Cannot find global package path, using current directory', 'yellow'));
    throw error;
  }
}

/**
 * Write Node.js executable path to node_path.txt for run_host scripts.
 * This ensures the native host uses the same Node.js version that was used during installation,
 * avoiding NODE_MODULE_VERSION mismatch errors with native modules like better-sqlite3.
 *
 * @param distDir - The dist directory where node_path.txt should be written
 * @param nodeExecPath - The Node.js executable path to write (defaults to current process.execPath)
 */
export function writeNodePathFile(distDir: string, nodeExecPath = process.execPath): void {
  try {
    const nodePathFile = path.join(distDir, 'node_path.txt');
    fs.mkdirSync(distDir, { recursive: true });

    console.log(colorText(`Writing Node.js path: ${nodeExecPath}`, 'blue'));
    fs.writeFileSync(nodePathFile, nodeExecPath, 'utf8');
    console.log(colorText('✓ Node.js path written for run_host scripts', 'green'));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(colorText(`⚠️ Failed to write Node.js path: ${message}`, 'yellow'));
  }
}

/**
 * 确保关键文件具有执行权限
 */
export async function ensureExecutionPermissions(): Promise<void> {
  try {
    const packageDistDir = path.join(__dirname, '..');

    if (process.platform === 'win32') {
      // Windows 平台处理
      await ensureWindowsFilePermissions(packageDistDir);
      return;
    }

    // Unix/Linux 平台处理
    const filesToCheck = [
      path.join(packageDistDir, 'index.js'),
      path.join(packageDistDir, 'run_host.sh'),
      path.join(packageDistDir, 'cli.js'),
    ];

    for (const filePath of filesToCheck) {
      if (fs.existsSync(filePath)) {
        try {
          fs.chmodSync(filePath, '755');
          console.log(
            colorText(`✓ Set execution permissions for ${path.basename(filePath)}`, 'green'),
          );
        } catch (err: any) {
          console.warn(
            colorText(
              `⚠️ Unable to set execution permissions for ${path.basename(filePath)}: ${err.message}`,
              'yellow',
            ),
          );
        }
      } else {
        console.warn(colorText(`⚠️ File not found: ${filePath}`, 'yellow'));
      }
    }
  } catch (error: any) {
    console.warn(colorText(`⚠️ Error ensuring execution permissions: ${error.message}`, 'yellow'));
  }
}

/**
 * Windows 平台文件权限处理
 */
async function ensureWindowsFilePermissions(packageDistDir: string): Promise<void> {
  const filesToCheck = [
    path.join(packageDistDir, 'index.js'),
    path.join(packageDistDir, 'run_host.bat'),
    path.join(packageDistDir, 'cli.js'),
  ];

  for (const filePath of filesToCheck) {
    if (fs.existsSync(filePath)) {
      try {
        // 检查文件是否为只读，如果是则移除只读属性
        const stats = fs.statSync(filePath);
        if (!(stats.mode & parseInt('200', 8))) {
          // 检查写权限
          // 尝试移除只读属性
          fs.chmodSync(filePath, stats.mode | parseInt('200', 8));
          console.log(
            colorText(`✓ Removed read-only attribute from ${path.basename(filePath)}`, 'green'),
          );
        }

        // 验证文件可读性
        fs.accessSync(filePath, fs.constants.R_OK);
        console.log(
          colorText(`✓ Verified file accessibility for ${path.basename(filePath)}`, 'green'),
        );
      } catch (err: any) {
        console.warn(
          colorText(
            `⚠️ Unable to verify file permissions for ${path.basename(filePath)}: ${err.message}`,
            'yellow',
          ),
        );
      }
    } else {
      console.warn(colorText(`⚠️ File not found: ${filePath}`, 'yellow'));
    }
  }
}

/**
 * Derive Chrome extension ID from a base64-encoded public key.
 * Algorithm: SHA-256 the raw key bytes, take first 32 hex chars,
 * map each hex digit 0-f → a-p.
 */
export function computeExtensionIdFromKey(base64Key: string): string {
  const keyBytes = Buffer.from(base64Key, 'base64');
  const hash = crypto.createHash('sha256').update(keyBytes).digest('hex');
  return hash
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16)));
}

/**
 * Try to read the `key` field from the built extension's manifest.json.
 * Searches common relative paths from the native-server package.
 */
export function findBuiltExtensionKey(): string | null {
  const candidates = [
    path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      'chrome-extension',
      '.output',
      'chrome-mv3',
      'manifest.json',
    ),
    path.resolve(
      __dirname,
      '..',
      '..',
      'chrome-extension',
      '.output',
      'chrome-mv3',
      'manifest.json',
    ),
  ];
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const manifest = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (typeof manifest.key === 'string' && manifest.key.length > 0) {
        return manifest.key;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Create Native Messaging host manifest content.
 *
 * Origin resolution order:
 * 1. Compute ID from the built extension's manifest.json `key` (always correct)
 * 2. Discover currently loaded extension IDs from Chrome Secure Preferences
 * 3. Fall back to the hardcoded EXTENSION_ID constant
 *
 * All unique origins are merged so the manifest stays valid across
 * extension upgrades, re-installs, and directory changes.
 */
export async function createManifestContent(): Promise<any> {
  const mainPath = await getMainPath();

  const originSet = new Set<string>();

  // 1. Key-derived ID (highest priority — always matches the current build)
  const builtKey = findBuiltExtensionKey();
  if (builtKey) {
    const keyDerivedId = computeExtensionIdFromKey(builtKey);
    originSet.add(`chrome-extension://${keyDerivedId}/`);
  }

  // 2. Discovered IDs from Chrome Secure Preferences
  const detectedOrigins = discoverLoadedExtensionOrigins();
  for (const origin of detectedOrigins.origins) {
    originSet.add(origin);
  }

  // 3. Fallback constant
  if (originSet.size === 0) {
    originSet.add(`chrome-extension://${EXTENSION_ID}/`);
  }

  return {
    name: HOST_NAME,
    description: DESCRIPTION,
    path: mainPath,
    type: 'stdio',
    allowed_origins: Array.from(originSet),
  };
}

function getSecurePreferencesPath(browser: BrowserType): string | null {
  const home = os.homedir();

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const baseDir =
      browser === BrowserType.CHROMIUM
        ? path.join(localAppData, 'Chromium', 'User Data')
        : path.join(localAppData, 'Google', 'Chrome', 'User Data');
    return path.join(baseDir, 'Default', 'Secure Preferences');
  }

  if (process.platform === 'darwin') {
    const baseDir =
      browser === BrowserType.CHROMIUM
        ? path.join(home, 'Library', 'Application Support', 'Chromium')
        : path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
    return path.join(baseDir, 'Default', 'Secure Preferences');
  }

  const baseDir =
    browser === BrowserType.CHROMIUM
      ? path.join(home, '.config', 'chromium')
      : path.join(home, '.config', 'google-chrome');
  return path.join(baseDir, 'Default', 'Secure Preferences');
}

function looksLikeChromeMcpExtensionPath(candidatePath: string): boolean {
  return /(tabrix|mcp-chrome)/i.test(candidatePath);
}

export function discoverLoadedExtensionOrigins(targetBrowsers?: BrowserType[]): {
  origins: string[];
  detected: DetectedExtensionOrigin[];
} {
  const browsers =
    targetBrowsers && targetBrowsers.length > 0
      ? targetBrowsers
      : detectInstalledBrowsers().length > 0
        ? detectInstalledBrowsers()
        : [BrowserType.CHROME, BrowserType.CHROMIUM];

  const detected: DetectedExtensionOrigin[] = [];

  for (const browser of browsers) {
    const securePreferencesPath = getSecurePreferencesPath(browser);
    if (!securePreferencesPath || !fs.existsSync(securePreferencesPath)) {
      continue;
    }

    try {
      const raw = fs.readFileSync(securePreferencesPath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const settings = (parsed.extensions as Record<string, unknown> | undefined)?.settings as
        | Record<string, unknown>
        | undefined;

      if (!settings) {
        continue;
      }

      for (const [id, entry] of Object.entries(settings)) {
        const extensionEntry = entry as Record<string, unknown>;
        const extensionPath = typeof extensionEntry.path === 'string' ? extensionEntry.path : '';
        if (!extensionPath || !looksLikeChromeMcpExtensionPath(extensionPath)) {
          continue;
        }

        detected.push({
          browser,
          id,
          path: extensionPath,
          securePreferencesPath,
        });
      }
    } catch {
      // ignore malformed Secure Preferences here; doctor surfaces parsing issues separately
    }
  }

  const origins = Array.from(new Set(detected.map((entry) => `chrome-extension://${entry.id}/`)));
  return { origins, detected };
}

/**
 * 验证Windows注册表项是否存在且指向正确路径
 */
function verifyWindowsRegistryEntry(registryKey: string, expectedPath: string): boolean {
  if (os.platform() !== 'win32') {
    return true; // 非Windows平台跳过验证
  }

  const normalizeForCompare = (filePath: string): string => path.normalize(filePath).toLowerCase();

  try {
    const output = execSync(`reg query "${registryKey}" /ve`, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    const lines = output
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    for (const line of lines) {
      const match = line.match(/REG_SZ\s+(.*)$/i);
      if (!match?.[1]) continue;
      const actualPath = match[1].trim();
      return normalizeForCompare(actualPath) === normalizeForCompare(expectedPath);
    }
  } catch {
    // ignore
  }

  return false;
}

/**
 * Write node_path.txt and then register user-level Native Messaging host.
 * This is the recommended entry point for development and production registration,
 * as it ensures the Node.js path is captured before registration.
 *
 * @param browsers - Optional list of browsers to register for
 * @returns true if at least one browser was registered successfully
 */
export async function registerUserLevelHostWithNodePath(
  browsers?: BrowserType[],
): Promise<boolean> {
  writeNodePathFile(path.join(__dirname, '..'));
  return tryRegisterUserLevelHost(browsers);
}

/**
 * 尝试注册用户级别的Native Messaging主机
 */
export async function tryRegisterUserLevelHost(targetBrowsers?: BrowserType[]): Promise<boolean> {
  try {
    console.log(colorText('Attempting to register user-level Native Messaging host...', 'blue'));

    // 1. 确保执行权限
    await ensureExecutionPermissions();

    // 2. 确定要注册的浏览器
    const browsersToRegister = targetBrowsers || detectInstalledBrowsers();
    const persistedBrowser = resolveAndPersistBrowserLaunchConfig(browsersToRegister);
    if (browsersToRegister.length === 0 || !persistedBrowser) {
      console.log(
        colorText(
          'No supported Chrome/Chromium executable was detected on this machine.',
          'yellow',
        ),
      );
      console.log(
        colorText(
          'Tabrix is installed, but browser automation is not ready until Chrome/Chromium is installed.',
          'yellow',
        ),
      );
      console.log(colorText(`After installing a browser, run: ${COMMAND_NAME} register`, 'blue'));
      return false;
    } else {
      console.log(colorText(`Detected browsers: ${browsersToRegister.join(', ')}`, 'blue'));
      console.log(
        colorText(
          `Using browser executable: ${persistedBrowser.executablePath} (${persistedBrowser.source})`,
          'green',
        ),
      );
    }

    // 3. 创建清单内容
    const manifest = await createManifestContent();

    let successCount = 0;
    const results: { browser: string; success: boolean; error?: string }[] = [];

    // 4. 为每个浏览器注册
    for (const browserType of browsersToRegister) {
      const config = getBrowserConfig(browserType);
      console.log(colorText(`\nRegistering for ${config.displayName}...`, 'blue'));

      try {
        // 确保目录存在
        await mkdir(path.dirname(config.userManifestPath), { recursive: true });

        // 写入清单文件
        await writeFile(config.userManifestPath, JSON.stringify(manifest, null, 2));
        console.log(colorText(`✓ Manifest written to ${config.userManifestPath}`, 'green'));

        // Windows需要额外注册表项
        if (os.platform() === 'win32' && config.registryKey) {
          try {
            // 注意：不需要手动双写反斜杠，reg 命令会正确处理 Windows 路径
            const regCommand = `reg add "${config.registryKey}" /ve /t REG_SZ /d "${config.userManifestPath}" /f`;
            execSync(regCommand, { stdio: 'pipe' });

            if (verifyWindowsRegistryEntry(config.registryKey, config.userManifestPath)) {
              console.log(colorText(`✓ Registry entry created for ${config.displayName}`, 'green'));
            } else {
              throw new Error('Registry verification failed');
            }
          } catch (error: any) {
            throw new Error(`Registry error: ${error.message}`);
          }
        }

        successCount++;
        results.push({ browser: config.displayName, success: true });
        console.log(colorText(`✓ Successfully registered ${config.displayName}`, 'green'));
      } catch (error: any) {
        results.push({ browser: config.displayName, success: false, error: error.message });
        console.log(
          colorText(`✗ Failed to register ${config.displayName}: ${error.message}`, 'red'),
        );
      }
    }

    // 5. 报告结果
    console.log(colorText('\n===== Registration Summary =====', 'blue'));
    for (const result of results) {
      if (result.success) {
        console.log(colorText(`✓ ${result.browser}: Success`, 'green'));
      } else {
        console.log(colorText(`✗ ${result.browser}: Failed - ${result.error}`, 'red'));
      }
    }

    return successCount > 0;
  } catch (error) {
    console.log(
      colorText(
        `User-level registration failed: ${error instanceof Error ? error.message : String(error)}`,
        'yellow',
      ),
    );
    return false;
  }
}

async function checkWindowsAdminRights(): Promise<boolean> {
  if (process.platform !== 'win32') {
    return false;
  }

  try {
    // fltmc succeeds only in elevated shells on standard Windows setups.
    execSync('fltmc', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 使用提升权限注册系统级清单
 */
export async function registerWithElevatedPermissions(
  targetBrowsers?: BrowserType[],
): Promise<void> {
  try {
    console.log(colorText('Attempting to register system-level manifest...', 'blue'));

    // 1. 确保执行权限
    await ensureExecutionPermissions();

    // 2. 准备清单内容
    const manifest = await createManifestContent();

    // 3. 确定要注册的浏览器
    const browsersToRegister = [...(targetBrowsers || detectInstalledBrowsers())];
    const persistedBrowser = resolveAndPersistBrowserLaunchConfig(browsersToRegister);
    if (browsersToRegister.length === 0 || !persistedBrowser) {
      throw new Error(
        `No supported Chrome/Chromium executable was detected. Install Chrome or Chromium, then rerun ${COMMAND_NAME} register --system`,
      );
    } else {
      console.log(colorText(`Target browsers: ${browsersToRegister.join(', ')}`, 'blue'));
      console.log(
        colorText(
          `Using browser executable: ${persistedBrowser.executablePath} (${persistedBrowser.source})`,
          'green',
        ),
      );
    }

    // 4. 创建临时清单文件
    const tempManifestPath = path.join(os.tmpdir(), `${HOST_NAME}.json`);
    await writeFile(tempManifestPath, JSON.stringify(manifest, null, 2));

    // 5. 检测是否已经有管理员权限
    const isRoot = process.getuid && process.getuid() === 0; // Unix/Linux/Mac
    const hasAdminRights = await checkWindowsAdminRights(); // Windows平台检测管理员权限
    const hasElevatedPermissions = isRoot || hasAdminRights;

    if (hasElevatedPermissions) {
      const results: { browser: string; success: boolean; error?: string }[] = [];

      for (const browserType of browsersToRegister) {
        const config = getBrowserConfig(browserType);
        const manifestPath = config.systemManifestPath;
        try {
          // 创建目录
          if (!fs.existsSync(path.dirname(manifestPath))) {
            fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
          }

          // 复制文件
          fs.copyFileSync(tempManifestPath, manifestPath);

          // 设置权限（非Windows平台）
          if (os.platform() !== 'win32') {
            fs.chmodSync(manifestPath, '644');
          }

          if (os.platform() === 'win32' && config.systemRegistryKey) {
            const regCommand = `reg add "${config.systemRegistryKey}" /ve /t REG_SZ /d "${manifestPath}" /f`;
            execSync(regCommand, { stdio: 'pipe' });
            if (!verifyWindowsRegistryEntry(config.systemRegistryKey, manifestPath)) {
              throw new Error('Registry verification failed');
            }
            console.log(colorText(`✓ Registry entry created for ${config.displayName}`, 'green'));
          }

          results.push({ browser: config.displayName, success: true });
          console.log(colorText(`✓ Registered ${config.displayName} (system level)`, 'green'));
        } catch (error: any) {
          results.push({ browser: config.displayName, success: false, error: error.message });
          console.error(
            colorText(`✗ Failed to register ${config.displayName}: ${error.message}`, 'red'),
          );
        }
      }

      const successCount = results.filter((item) => item.success).length;
      if (successCount === 0) {
        throw new Error('System-level registration failed for all target browsers');
      }

      console.log(colorText('\n===== System Registration Summary =====', 'blue'));
      for (const result of results) {
        if (result.success) {
          console.log(colorText(`✓ ${result.browser}: Success`, 'green'));
        } else {
          console.log(colorText(`✗ ${result.browser}: Failed - ${result.error}`, 'red'));
        }
      }
    } else {
      // 没有管理员权限，打印手动操作提示
      console.log(
        colorText('⚠️ Administrator privileges required for system-level installation', 'yellow'),
      );
      console.log(
        colorText(
          'Please run one of the following commands with administrator privileges:',
          'blue',
        ),
      );

      for (const browserType of browsersToRegister) {
        const config = getBrowserConfig(browserType);
        const manifestPath = config.systemManifestPath;
        const command =
          os.platform() === 'win32'
            ? `if not exist "${path.dirname(manifestPath)}" mkdir "${path.dirname(manifestPath)}" && copy "${tempManifestPath}" "${manifestPath}"`
            : `mkdir -p "${path.dirname(manifestPath)}" && cp "${tempManifestPath}" "${manifestPath}" && chmod 644 "${manifestPath}"`;

        console.log(colorText(`  - ${config.displayName}:`, 'blue'));
        if (os.platform() === 'win32') {
          console.log(colorText(`    ${command}`, 'cyan'));
          if (config.systemRegistryKey) {
            console.log(
              colorText(
                `    reg add "${config.systemRegistryKey}" /ve /t REG_SZ /d "${manifestPath}" /f`,
                'cyan',
              ),
            );
          }
        } else {
          console.log(colorText(`    sudo ${command}`, 'cyan'));
        }
      }

      console.log(colorText('\nOr rerun with elevated privileges:', 'blue'));
      console.log(colorText(`  sudo ${COMMAND_NAME} register --system`, 'cyan'));

      throw new Error('Administrator privileges required for system-level installation');
    }
  } catch (error: any) {
    console.error(colorText(`注册失败: ${error.message}`, 'red'));
    throw error;
  }
}
