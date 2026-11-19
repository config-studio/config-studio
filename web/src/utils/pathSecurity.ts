/**
 * Path Security & Traversal Prevention Utilities (CWE-22 / CWE-23 mitigation)
 */

export function sanitizeBaseName(name: string): string {
  if (!name) {
    throw new Error('Имя файла или каталога не может быть пустым');
  }

  // Remove null bytes and control chars
  const clean = name.replace(/[\0\x01-\x1f\x7f]/g, '').trim();

  // Strip path separators: extract only base filename
  const base = clean.split(/[/\\]/).pop() || '';

  if (!base || base === '.' || base === '..') {
    throw new Error('Недопустимое имя файла или каталога');
  }

  return base;
}

export function joinSafePath(baseDir: string, childName: string): string {
  const safeName = sanitizeBaseName(childName);
  const normalizedBase = baseDir.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalizedBase ? `${normalizedBase}/${safeName}` : `/${safeName}`;
}

export function resolveSafeParentDir(currentPath: string, isLocal: boolean): string {
  const parts = currentPath.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean);
  parts.pop();

  if (isLocal) {
    // Local workspace: cannot navigate above root ('')
    return parts.length === 0 ? '' : parts.join('/');
  }

  // Remote SFTP: root is '/'
  return parts.length === 0 ? '/' : '/' + parts.join('/');
}
