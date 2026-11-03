import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Dropdown, DropdownOption, DropdownProps } from './Dropdown';

export interface VanillaDropdownConfig {
  options: DropdownOption[];
  value?: string | number | null;
  onChange?: (val: any, opt?: DropdownOption) => void;
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  label?: string;
  description?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
  clearable?: boolean;
  accentColor?: string;
}

export interface VanillaDropdownController {
  getValue: () => string | number | null | undefined;
  setValue: (value: string | number | null) => void;
  setOptions: (options: DropdownOption[]) => void;
  setError: (error: string | undefined) => void;
  setDisabled: (disabled: boolean) => void;
  destroy: () => void;
}

export function mountDropdown(
  container: HTMLElement,
  config: VanillaDropdownConfig
): VanillaDropdownController {
  let root: Root | null = createRoot(container);
  let currentValue = config.value !== undefined ? config.value : null;
  let currentOptions = config.options || [];
  let currentError = config.error;
  let currentDisabled = !!config.disabled;

  function render() {
    if (!root) return;
    root.render(
      <Dropdown
        options={currentOptions}
        value={currentValue}
        onChange={(val, opt) => {
          currentValue = val;
          render();
          if (config.onChange) {
            config.onChange(val, opt);
          }
        }}
        placeholder={config.placeholder}
        searchable={config.searchable}
        searchPlaceholder={config.searchPlaceholder}
        label={config.label}
        description={config.description}
        error={currentError}
        disabled={currentDisabled}
        className={config.className}
        menuClassName={config.menuClassName}
        clearable={config.clearable}
        accentColor={config.accentColor}
      />
    );
  }

  render();

  return {
    getValue: () => currentValue,
    setValue: (val: string | number | null) => {
      currentValue = val;
      render();
    },
    setOptions: (opts: DropdownOption[]) => {
      currentOptions = opts;
      render();
    },
    setError: (err: string | undefined) => {
      currentError = err;
      render();
    },
    setDisabled: (dis: boolean) => {
      currentDisabled = dis;
      render();
    },
    destroy: () => {
      if (root) {
        root.unmount();
        root = null;
      }
    },
  };
}
