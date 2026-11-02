import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Copy, Check, Download, ChevronDown, ChevronUp } from 'lucide-react';
import { telemetry } from '../services/telemetry';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
    showDetails: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error('[ConfigStudio] Uncaught render error:', error, errorInfo);

    telemetry.captureError(error, {
      source: 'ErrorBoundary',
      componentStack: errorInfo.componentStack,
    });
  }

  private handleCopy = async () => {
    const success = await telemetry.copyDiagnosticReport({
      error: this.state.error,
      componentStack: this.state.errorInfo?.componentStack,
    });
    if (success) {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2500);
    }
  };

  private handleDownload = () => {
    telemetry.downloadCrashReport({
      error: this.state.error,
      componentStack: this.state.errorInfo?.componentStack,
    });
  };

  public render() {
    if (this.state.hasError) {
      const errorMsg = this.state.error?.message || 'Неизвестная ошибка интерфейса';
      const stack = this.state.error?.stack || this.state.errorInfo?.componentStack || '';

      return (
        <div className="fixed inset-0 bg-[#0f111a] text-white flex flex-col items-center justify-center p-6 select-none z-[99999]">
          <div className="max-w-xl w-full bg-[#161b22] border border-rose-500/40 rounded-2xl p-6 shadow-2xl text-center space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
              <AlertTriangle size={24} />
            </div>

            <div className="space-y-1">
              <h2 className="text-base font-semibold text-gray-100">
                Произошла ошибка интерфейса
              </h2>
              <p className="text-xs text-gray-400">
                Событие зафиксировано в структурированном журнале телеметрии.
              </p>
            </div>

            {/* Error Message Box */}
            <div className="text-xs text-rose-300 font-mono bg-black/50 p-3 rounded-xl border border-rose-950/60 text-left overflow-x-auto max-h-32">
              {errorMsg}
            </div>

            {/* AI Report & Crash Actions */}
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                type="button"
                onClick={this.handleCopy}
                className={`flex-1 inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold shadow-md transition ${
                  this.state.copied
                    ? 'bg-emerald-600 text-white'
                    : 'bg-teal-600 hover:bg-teal-500 text-white hover:shadow-teal-500/20'
                }`}
                title="Скопировать готовый Markdown отчёт с контекстом последних действий для отправки ИИ"
              >
                {this.state.copied ? <Check size={14} /> : <Copy size={14} />}
                <span>
                  {this.state.copied
                    ? 'Отчёт скопирован для ИИ'
                    : 'Скопировать диагностический отчёт для ИИ'}
                </span>
              </button>

              <button
                type="button"
                onClick={this.handleDownload}
                className="inline-flex items-center justify-center gap-2 px-3 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-gray-700/60 rounded-xl text-xs font-medium transition"
                title="Скачать структурированный JSON отчёт о сбое"
              >
                <Download size={14} />
                <span>Crash Report</span>
              </button>
            </div>

            {/* Collapsible Stack Trace */}
            {stack && (
              <div className="text-left border-t border-gray-800/80 pt-3">
                <button
                  type="button"
                  onClick={() => this.setState((s) => ({ showDetails: !s.showDetails }))}
                  className="inline-flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-200 transition"
                >
                  {this.state.showDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  <span>{this.state.showDetails ? 'Скрыть технические подробности' : 'Показать стек вызовов'}</span>
                </button>

                {this.state.showDetails && (
                  <pre className="mt-2 p-2.5 rounded-lg bg-black/60 border border-gray-800 text-[10px] text-gray-400 font-mono overflow-auto max-h-40 leading-relaxed whitespace-pre-wrap break-all">
                    {stack}
                  </pre>
                )}
              </div>
            )}

            {/* Reload button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-xl text-xs font-medium transition"
              >
                <RefreshCw size={13} />
                <span>Перезагрузить страницу</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
