import React, { useRef, useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';

export interface DropzoneProps {
  accept?: string;
  icon?: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  onFileSelected?: (file: File) => void;
  onFilesSelected?: (files: FileList) => void;
  multiple?: boolean;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}

export const Dropzone: React.FC<DropzoneProps> = ({
  accept,
  icon,
  title = 'Перетащите файл сюда',
  subtitle = 'или нажмите для выбора с устройства',
  onFileSelected,
  onFilesSelected,
  multiple = false,
  disabled = false,
  loading = false,
  className = '',
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleClick = () => {
    if (disabled || loading) return;
    fileInputRef.current?.click();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (disabled || loading) return;
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled || loading) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      if (multiple && onFilesSelected) {
        onFilesSelected(e.dataTransfer.files);
      } else if (onFileSelected) {
        onFileSelected(e.dataTransfer.files[0]);
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      if (multiple && onFilesSelected) {
        onFilesSelected(e.target.files);
      } else if (onFileSelected) {
        onFileSelected(e.target.files[0]);
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-2xl p-5 flex flex-col items-center justify-center text-center transition select-none group ${
        disabled
          ? 'opacity-50 cursor-not-allowed border-base-border bg-black/5 dark:bg-white/5'
          : isDragOver
          ? 'border-accent bg-accent/10 cursor-copy scale-[1.005]'
          : 'border-base-border hover:border-accent/70 bg-black/5 dark:bg-white/5 hover:bg-accent/5 cursor-pointer'
      } ${className}`}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleChange}
        accept={accept}
        multiple={multiple}
        disabled={disabled || loading}
        className="hidden"
      />

      <div className="mb-2 transition group-hover:scale-105">
        {loading ? (
          <Loader2 size={24} className="text-accent animate-spin" />
        ) : icon !== undefined ? (
          icon
        ) : (
          <Upload size={24} className="text-gray-400 group-hover:text-accent transition-colors" />
        )}
      </div>

      <div className="text-xs font-semibold text-[var(--text-primary)] mb-0.5">
        {title}
      </div>

      {subtitle && (
        <div className="text-[11px] text-[var(--text-muted)] leading-relaxed">
          {subtitle}
        </div>
      )}
    </div>
  );
};
