import React from 'react';

export type StatusDotType =
  | 'online'
  | 'connected'
  | 'offline'
  | 'disconnected'
  | 'warning'
  | 'warn'
  | 'connecting'
  | 'error'
  | 'idle'
  | 'neutral'
  | 'green'
  | 'amber'
  | 'red'
  | 'gray';

export interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  status?: StatusDotType;
  size?: 'xs' | 'sm' | 'md';
  pulse?: boolean;
  ping?: boolean;
  title?: string;
  className?: string;
}

const sizeClasses = {
  xs: 'w-1.5 h-1.5',
  sm: 'w-2 h-2',
  md: 'w-2.5 h-2.5',
};

const ringSizeClasses = {
  xs: 'ring-1',
  sm: 'ring-1.5',
  md: 'ring-2',
};

export const StatusDot: React.FC<StatusDotProps> = ({
  status = 'neutral',
  size = 'sm',
  pulse,
  ping = false,
  title,
  className = '',
  ...props
}) => {
  // Normalize status categories
  let colorClass = 'bg-slate-400 ring-slate-400/30 dark:ring-slate-500/40';
  let defaultTitle = 'Неизвестно';
  let shouldPulse = pulse;

  switch (status) {
    case 'online':
    case 'connected':
    case 'green':
      colorClass = 'bg-emerald-500 ring-emerald-500/30 dark:ring-emerald-400/40';
      defaultTitle = 'В сети / Подключено';
      break;

    case 'warning':
    case 'warn':
    case 'amber':
      colorClass = 'bg-amber-500 ring-amber-500/30 dark:ring-amber-400/40';
      defaultTitle = 'Предупреждение';
      break;

    case 'connecting':
      colorClass = 'bg-amber-400 ring-amber-400/30 dark:ring-amber-300/40';
      defaultTitle = 'Подключение...';
      if (shouldPulse === undefined) shouldPulse = true;
      break;

    case 'offline':
    case 'disconnected':
    case 'error':
    case 'red':
      colorClass = 'bg-rose-500 ring-rose-500/30 dark:ring-rose-400/40';
      defaultTitle = 'Не в сети / Ошибка';
      break;

    case 'idle':
    case 'neutral':
    case 'gray':
    default:
      colorClass = 'bg-slate-400 ring-slate-400/30 dark:ring-slate-500/40';
      defaultTitle = 'Не активен';
      break;
  }

  return (
    <span
      className={`relative inline-flex items-center justify-center shrink-0 select-none ${className}`}
      title={title || defaultTitle}
      {...props}
    >
      {/* Optional ping ring for active live states */}
      {ping && (
        <span
          className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${
            status === 'online' || status === 'connected' || status === 'green'
              ? 'bg-emerald-400'
              : 'bg-amber-400'
          }`}
        />
      )}

      {/* Main crisp solid dot with concentric ring */}
      <span
        className={`rounded-full shrink-0 ${sizeClasses[size]} ${ringSizeClasses[size]} ${colorClass} ${
          shouldPulse ? 'animate-pulse' : ''
        }`}
      />
    </span>
  );
};
