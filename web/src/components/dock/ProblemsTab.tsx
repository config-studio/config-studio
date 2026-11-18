import React from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { GuardValidationResult } from '../../types';
import { Badge, EmptyState } from '../ui';

export interface ProblemsTabProps {
  guardResult: GuardValidationResult | null;
  onJumpToLine?: (line: number, col: number) => void;
  emptyText?: string;
}

export const ProblemsTab: React.FC<ProblemsTabProps> = ({
  guardResult,
  onJumpToLine,
  emptyText = 'Проблем не обнаружено',
}) => {
  if (!guardResult || !guardResult.issues || guardResult.issues.length === 0) {
    return (
      <div className="py-6">
        <EmptyState
          icon={<CheckCircle2 size={24} className="text-emerald-500" />}
          title={emptyText}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1 p-2">
      {guardResult.issues.map((iss, idx) => (
        <div
          key={idx}
          onClick={() => onJumpToLine?.(iss.line, iss.column)}
          className={`flex items-start justify-between p-3 rounded-xl cursor-pointer transition border select-none ${
            iss.severity === 'critical'
              ? 'bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/15'
              : 'bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/15'
          }`}
        >
          <div className="flex items-start space-x-2.5 min-w-0 flex-1">
            <AlertCircle
              size={15}
              className={`shrink-0 mt-0.5 ${
                iss.severity === 'critical'
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            />
            <div className="min-w-0 flex-1">
              <div
                className={`font-semibold text-xs leading-snug ${
                  iss.severity === 'critical'
                    ? 'text-rose-950 dark:text-rose-100'
                    : 'text-amber-950 dark:text-amber-100'
                }`}
              >
                {iss.message}
              </div>
              {iss.snippet && (
                <pre
                  className={`text-[11px] font-mono leading-relaxed mt-2 p-2.5 rounded-lg border overflow-x-auto select-text shadow-2xs ${
                    iss.severity === 'critical'
                      ? 'bg-white/95 text-slate-800 border-rose-200/80 dark:bg-black/50 dark:text-slate-200 dark:border-rose-900/40'
                      : 'bg-white/95 text-slate-800 border-amber-200/80 dark:bg-black/50 dark:text-slate-200 dark:border-amber-900/40'
                  }`}
                >
                  {iss.snippet.split('\n').map((line, lIdx) => {
                    const isTarget = line.startsWith('>');
                    return (
                      <div
                        key={lIdx}
                        className={
                          isTarget
                            ? 'bg-rose-500/15 text-rose-900 dark:text-rose-200 font-bold px-1.5 py-0.5 rounded -mx-1 border-l-2 border-rose-500'
                            : 'text-slate-600 dark:text-gray-400'
                        }
                      >
                        {line}
                      </div>
                    );
                  })}
                </pre>
              )}
            </div>
          </div>
          <div className="text-right shrink-0 pl-3">
            <Badge
              variant={iss.severity === 'critical' ? 'error' : 'warning'}
              size="xs"
              className="font-mono font-medium"
            >
              {iss.file}:{iss.line}:{iss.column}
            </Badge>
          </div>
        </div>
      ))}
    </div>
  );
};
