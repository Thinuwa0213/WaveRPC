import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@waverpc/shared';

const log = new Logger('AppVersion');

export function resolveAppVersion(): string {
  // 1. Packaged: prefer app.getVersion()
  if (app && app.isPackaged) {
    const version = app.getVersion();
    if (version && version !== '0.0.0' && version !== '0.0.0-development') {
      return version;
    }
  }

  // 2. Development or fallback: resolve from apps/desktop/package.json
  try {
    const pkgPath = path.join(__dirname, '../../package.json');
    if (fs.existsSync(pkgPath)) {
      const content = fs.readFileSync(pkgPath, 'utf8');
      const pkg = JSON.parse(content);
      if (pkg && pkg.version) {
        return pkg.version;
      }
    }
  } catch (err: any) {
    log.error('Failed to resolve version from package.json:', err.message);
  }

  // 3. Ultimate fallback
  try {
    return app.getVersion() || '0.0.0';
  } catch {
    return '0.0.0';
  }
}
