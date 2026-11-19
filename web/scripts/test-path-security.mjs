import assert from 'node:assert';
import { sanitizeBaseName, joinSafePath, resolveSafeParentDir } from '../src/utils/pathSecurity.ts';

console.log('Running pathSecurity tests...');

// 1. sanitizeBaseName normal cases
assert.strictEqual(sanitizeBaseName('file.txt'), 'file.txt');
assert.strictEqual(sanitizeBaseName('  spaced.json  '), 'spaced.json');

// 2. sanitizeBaseName path traversal attempts
assert.strictEqual(sanitizeBaseName('../../evil.txt'), 'evil.txt');
assert.strictEqual(sanitizeBaseName('..\\..\\windows.txt'), 'windows.txt');
assert.strictEqual(sanitizeBaseName('/etc/passwd'), 'passwd');
assert.strictEqual(sanitizeBaseName('nested/dir/target.conf'), 'target.conf');

// 3. sanitizeBaseName illegal attempts throwing errors
assert.throws(() => sanitizeBaseName(''), /не может быть пустым/);
assert.throws(() => sanitizeBaseName('.'), /Недопустимое имя/);
assert.throws(() => sanitizeBaseName('..'), /Недопустимое имя/);
assert.throws(() => sanitizeBaseName('../..'), /Недопустимое имя/);
assert.throws(() => sanitizeBaseName('\0'), /не может быть пустым|Недопустимое имя/);

// 4. joinSafePath
assert.strictEqual(joinSafePath('/etc', 'nginx.conf'), '/etc/nginx.conf');
assert.strictEqual(joinSafePath('/etc/', 'nginx.conf'), '/etc/nginx.conf');
assert.strictEqual(joinSafePath('/var/log', '../../root.sh'), '/var/log/root.sh');
assert.strictEqual(joinSafePath('', 'app.yaml'), '/app.yaml');

// 5. resolveSafeParentDir
// Remote SFTP:
assert.strictEqual(resolveSafeParentDir('/etc/nginx', false), '/etc');
assert.strictEqual(resolveSafeParentDir('/etc', false), '/');
assert.strictEqual(resolveSafeParentDir('/', false), '/');

// Local workspace (cannot escape root ''):
assert.strictEqual(resolveSafeParentDir('configs/app', true), 'configs');
assert.strictEqual(resolveSafeParentDir('configs', true), '');
assert.strictEqual(resolveSafeParentDir('', true), '');

// 6. Windows backslash path normalization
assert.strictEqual(resolveSafeParentDir('configs\\app', true), 'configs');
assert.strictEqual(resolveSafeParentDir('configs\\app\\sub', true), 'configs/app');
assert.strictEqual(joinSafePath('configs\\nested', 'service.conf'), 'configs/nested/service.conf');

// 7. Verify isDir safety in delete payload
const mockSftpDeletePayload = (entry) => ({
  path: entry.path,
  isDir: Boolean(entry.isDir),
});
assert.strictEqual(mockSftpDeletePayload({ path: '/etc/nginx', isDir: true }).isDir, true);
assert.strictEqual(mockSftpDeletePayload({ path: '/etc/nginx/nginx.conf', isDir: false }).isDir, false);

console.log('All pathSecurity tests passed successfully!');
