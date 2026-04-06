import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/services';

interface ApiState<T> {
  data:       T | null;
  isLoading:  boolean;
  error:      string | null;
}

interface UseApiReturn<T> extends ApiState<T> {
  refetch: () => void;
}

/**
 * 데이터 패칭 훅
 *
 * const { data, isLoading, error, refetch } = useApi(
 *   () => positionsService.getAll(),
 *   []
 * );
 */
export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): UseApiReturn<T> {
  const [state, setState] = useState<ApiState<T>>({
    data:      null,
    isLoading: true,
    error:     null,
  });

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const fetch = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await fetcherRef.current();
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      const message = err instanceof ApiError
        ? err.message
        : '데이터를 불러오지 못했어요.';
      setState((prev) => ({ ...prev, isLoading: false, error: message }));
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetch(); }, [fetch]);

  return { ...state, refetch: fetch };
}

/**
 * 뮤테이션 훅 (POST / PATCH / DELETE)
 *
 * const { mutate, isLoading, error } = useMutation(
 *   (body) => accountService.requestDeposit(body),
 *   { onSuccess: () => router.back() }
 * );
 */
interface MutationOptions<T> {
  onSuccess?: (data: T) => void;
  onError?:   (error: ApiError | Error) => void;
}

interface UseMutationReturn<TArgs, TData> {
  mutate:    (args: TArgs) => Promise<void>;
  isLoading: boolean;
  error:     string | null;
}

export function useMutation<TArgs, TData>(
  fn: (args: TArgs) => Promise<TData>,
  options: MutationOptions<TData> = {},
): UseMutationReturn<TArgs, TData> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const mutate = async (args: TArgs) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fn(args);
      options.onSuccess?.(data);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '오류가 발생했어요.';
      setError(message);
      options.onError?.(err as Error);
    } finally {
      setIsLoading(false);
    }
  };

  return { mutate, isLoading, error };
}
