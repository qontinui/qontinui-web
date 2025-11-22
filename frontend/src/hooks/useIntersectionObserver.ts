import { useEffect, useState, RefObject } from 'react';

/**
 * Custom hook for intersection observer
 * Used for lazy loading images when they become visible in the viewport
 *
 * @param ref - React ref to the element to observe
 * @param options - IntersectionObserver options
 * @returns boolean indicating if the element is currently visible
 *
 * @example
 * const ref = useRef<HTMLDivElement>(null);
 * const isVisible = useIntersectionObserver(ref, {
 *   threshold: 0.1,
 *   rootMargin: '100px'
 * });
 */
export function useIntersectionObserver(
  ref: RefObject<Element>,
  options?: IntersectionObserverInit
): boolean {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Default options: trigger when 10% visible, with 100px margin for preloading
    const defaultOptions: IntersectionObserverInit = {
      threshold: 0.1,
      rootMargin: '100px',
      ...options,
    };

    const observer = new IntersectionObserver(([entry]) => {
      // Once visible, keep it visible (for lazy loading)
      // Images should load once and stay loaded
      if (entry.isIntersecting) {
        setIsVisible(true);
      }
    }, defaultOptions);

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [ref, options?.threshold, options?.rootMargin, options?.root]);

  return isVisible;
}

/**
 * Variant of useIntersectionObserver that resets when element leaves viewport
 * Useful for animations or effects that should retrigger
 *
 * @param ref - React ref to the element to observe
 * @param options - IntersectionObserver options
 * @returns boolean indicating if the element is currently visible
 */
export function useIntersectionObserverRepeating(
  ref: RefObject<Element>,
  options?: IntersectionObserverInit
): boolean {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const defaultOptions: IntersectionObserverInit = {
      threshold: 0.1,
      rootMargin: '0px',
      ...options,
    };

    const observer = new IntersectionObserver(([entry]) => {
      setIsVisible(entry.isIntersecting);
    }, defaultOptions);

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [ref, options?.threshold, options?.rootMargin, options?.root]);

  return isVisible;
}
