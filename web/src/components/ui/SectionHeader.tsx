import React from 'react';

export interface SectionHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  rightElement?: React.ReactNode;
  className?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  subtitle,
  icon,
  badge,
  rightElement,
  className = '',
}) => {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <div className="flex items-center space-x-2 min-w-0">
        {icon && <div className="text-accent shrink-0">{icon}</div>}
        <div className="min-w-0">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider truncate">
              {title}
            </span>
            {badge && <div className="shrink-0">{badge}</div>}
          </div>
          {subtitle && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {rightElement && <div className="shrink-0">{rightElement}</div>}
    </div>
  );
};
