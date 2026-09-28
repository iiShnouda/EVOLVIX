import { QueryClient } from '@tanstack/react-query';

/**
 * React Query caches server data IN MEMORY for the current session only. `gcTime: 0`-ish
 * behavior plus no persistence means nothing survives a reload — aligning with the
 * "no business data at rest on the device" security rule.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Never persist; cache is dropped shortly after unmount.
      gcTime: 60_000,
    },
  },
});
