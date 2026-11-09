import React, { forwardRef, useRef, useCallback, useEffect } from 'react';

export interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: 'vertical' | 'horizontal' | 'both';
  maxHeight?: string | number;
  minHeight?: string | number;
  height?: string | number;
  contentClassName?: string;
  horizontalWheel?: boolean;
}

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
  (
    {
      children,
      orientation = 'vertical',
      className = '',
      contentClassName = '',
      maxHeight,
      minHeight,
      height,
      horizontalWheel,
      style,
      onWheel,
      ...props
    },
    ref
  ) => {
    const localRef = useRef<HTMLDivElement | null>(null);

    const setRef = useCallback(
      (node: HTMLDivElement | null) => {
        localRef.current = node;
        if (typeof ref === 'function') {
          ref(node);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }
      },
      [ref]
    );

    const shouldScrollHorizontally =
      horizontalWheel ?? (orientation === 'horizontal');

    // Native non-passive wheel event listener to allow e.preventDefault()
    // preventing vertical parent scrolling when scrolling horizontally
    useEffect(() => {
      const el = localRef.current;
      if (!el || !shouldScrollHorizontally) return;

      const onNativeWheel = (e: WheelEvent) => {
        // If user rolls the mouse wheel vertically (deltaY != 0) without native horizontal delta (deltaX == 0)
        if (e.deltaY !== 0 && e.deltaX === 0) {
          const maxScrollLeft = el.scrollWidth - el.clientWidth;
          if (maxScrollLeft > 0) {
            const canScrollLeft = e.deltaY < 0 && el.scrollLeft > 0;
            const canScrollRight = e.deltaY > 0 && el.scrollLeft < maxScrollLeft;

            if (canScrollLeft || canScrollRight) {
              e.preventDefault();
              el.scrollLeft += e.deltaY;
            }
          }
        }
      };

      el.addEventListener('wheel', onNativeWheel, { passive: false });
      return () => {
        el.removeEventListener('wheel', onNativeWheel);
      };
    }, [shouldScrollHorizontally]);

    let overflowClass = 'overflow-y-auto overflow-x-hidden';
    if (orientation === 'horizontal') {
      overflowClass = 'overflow-x-auto overflow-y-hidden';
    } else if (orientation === 'both') {
      overflowClass = 'overflow-auto';
    }

    const customStyle: React.CSSProperties = {
      ...style,
      ...(maxHeight ? { maxHeight } : {}),
      ...(minHeight ? { minHeight } : {}),
      ...(height ? { height } : {}),
    };

    return (
      <div
        ref={setRef}
        style={customStyle}
        onWheel={onWheel}
        className={`custom-scrollbar ${overflowClass} ${className}`}
        {...props}
      >
        <div className={contentClassName}>{children}</div>
      </div>
    );
  }
);

ScrollArea.displayName = 'ScrollArea';
