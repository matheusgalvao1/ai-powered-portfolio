import { useEffect, useState } from "react";

const COMPACT_QUERY = "(max-width: 767px)";

// Matches the CSS breakpoint where the orb gutter collapses and the
// conversation rail behaves as a drawer.
export function useIsCompact(): boolean {
  const [isCompact, setIsCompact] = useState(
    () => window.matchMedia(COMPACT_QUERY).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    const listener = (event: MediaQueryListEvent) => setIsCompact(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  return isCompact;
}
