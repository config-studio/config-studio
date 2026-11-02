import React from 'react';
import {
  Folder,
  FileText,
  FileCode,
  Code,
  Database,
  Terminal,
  Sliders,
  Key,
  GitBranch,
  Package,
  Image as ImageIcon,
  Cpu,
} from 'lucide-react';
import {
  DockerIcon,
  NginxIcon,
  CaddyIcon,
  LinuxIcon,
  RedisIcon,
} from './BrandIcons';

export interface FileFormatIconProps {
  filename: string;
  isDir?: boolean;
  className?: string;
}

export const FileFormatIcon: React.FC<FileFormatIconProps> = ({
  filename,
  isDir = false,
  className = 'w-4 h-4 shrink-0',
}) => {
  if (isDir) {
    return <Folder className={`${className} text-accent`} />;
  }

  const name = filename || '';
  const lower = name.toLowerCase();

  // 1. Docker & Container stack
  if (
    lower === 'dockerfile' ||
    lower.startsWith('dockerfile.') ||
    lower === 'docker-compose.yml' ||
    lower === 'docker-compose.yaml' ||
    lower === 'compose.yml' ||
    lower === 'compose.yaml' ||
    lower === '.dockerignore' ||
    lower.startsWith('docker-compose.')
  ) {
    return <DockerIcon className={`${className} text-sky-400`} />;
  }

  // 2. Nginx
  if (
    lower === 'nginx.conf' ||
    (lower.includes('nginx') && (lower.endsWith('.conf') || lower.endsWith('.vhost')))
  ) {
    return <NginxIcon className={`${className} text-teal-400`} />;
  }

  // 3. Caddy
  if (
    lower === 'caddyfile' ||
    lower.startsWith('caddyfile.') ||
    lower.endsWith('.caddy')
  ) {
    return <CaddyIcon className={`${className} text-cyan-400`} />;
  }

  // 4. Systemd services and Linux timers
  if (
    lower.endsWith('.service') ||
    lower.endsWith('.timer') ||
    lower.endsWith('.socket') ||
    lower.endsWith('.target') ||
    lower.endsWith('.mount') ||
    lower.endsWith('.automount') ||
    lower.endsWith('.path')
  ) {
    return <Cpu className={`${className} text-amber-400`} />;
  }

  // 5. Database & In-memory caches
  if (lower.includes('redis') && lower.endsWith('.conf')) {
    return <RedisIcon className={`${className} text-red-500`} />;
  }
  if (
    lower.endsWith('.sql') ||
    lower.endsWith('.db') ||
    lower.endsWith('.sqlite') ||
    lower.endsWith('.sqlite3') ||
    lower.endsWith('.pgsql') ||
    lower.includes('postgres') && lower.endsWith('.conf') ||
    lower === 'my.cnf'
  ) {
    return <Database className={`${className} text-purple-400`} />;
  }

  // 6. Shell & Automation scripts
  if (
    lower.endsWith('.sh') ||
    lower.endsWith('.bash') ||
    lower.endsWith('.zsh') ||
    lower.endsWith('.fish') ||
    lower.endsWith('.ps1') ||
    lower.endsWith('.bat') ||
    lower.endsWith('.cmd')
  ) {
    return <Terminal className={`${className} text-orange-400`} />;
  }

  // 7. Environment & Secrets
  if (lower === '.env' || lower.startsWith('.env.')) {
    return <Sliders className={`${className} text-rose-400`} />;
  }

  // 8. Security keys, SSL/TLS certificates
  if (
    lower.endsWith('.key') ||
    lower.endsWith('.pem') ||
    lower.endsWith('.crt') ||
    lower.endsWith('.cer') ||
    lower.endsWith('.pub') ||
    lower.endsWith('.pfx') ||
    lower.startsWith('id_rsa') ||
    lower.startsWith('id_ed25519')
  ) {
    return <Key className={`${className} text-yellow-400`} />;
  }

  // 9. Git version control
  if (
    lower === '.gitignore' ||
    lower === '.gitattributes' ||
    lower === '.gitmodules'
  ) {
    return <GitBranch className={`${className} text-red-400`} />;
  }

  // 10. YAML configs
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
    return <FileCode className={`${className} text-emerald-500`} />;
  }

  // 11. JSON configs
  if (lower.endsWith('.json') || lower.endsWith('.jsonc') || lower.endsWith('.json5')) {
    return <FileCode className={`${className} text-amber-500`} />;
  }

  // 12. TOML & INI configs
  if (
    lower.endsWith('.toml') ||
    lower.endsWith('.ini') ||
    lower.endsWith('.cfg') ||
    lower.endsWith('.conf') ||
    lower.endsWith('.properties')
  ) {
    return <FileCode className={`${className} text-indigo-400`} />;
  }

  // 13. Web & Source code
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return <FileCode className={`${className} text-orange-500`} />;
  }
  if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.less')) {
    return <FileCode className={`${className} text-blue-400`} />;
  }
  if (
    lower.endsWith('.js') ||
    lower.endsWith('.ts') ||
    lower.endsWith('.jsx') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.php') ||
    lower.endsWith('.py') ||
    lower.endsWith('.go')
  ) {
    return <Code className={`${className} text-yellow-500`} />;
  }

  // 14. Documentation & text
  if (
    lower.endsWith('.md') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.log') ||
    lower === 'license' ||
    lower === 'readme'
  ) {
    return <FileText className={`${className} text-gray-400`} />;
  }

  // 15. Archives & Package bundles
  if (
    lower.endsWith('.zip') ||
    lower.endsWith('.tar') ||
    lower.endsWith('.gz') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.cspkg') ||
    lower.endsWith('.rar') ||
    lower.endsWith('.7z')
  ) {
    return <Package className={`${className} text-blue-400`} />;
  }

  // 16. Images
  if (
    lower.endsWith('.svg') ||
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.ico') ||
    lower.endsWith('.gif')
  ) {
    return <ImageIcon className={`${className} text-pink-400`} />;
  }

  // Default fallback
  return <FileText className={`${className} text-gray-400`} />;
};
