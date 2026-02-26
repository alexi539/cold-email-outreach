import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { accounts, inbox } from "../api";
import type { Account, InboxMessageListItem } from "../api";

const STORAGE_KEY_LAST_ACCOUNT = "inbox.lastAccountId";
const STORAGE_KEY_CACHE = "inbox.cache";
const CACHE_LIMIT_ALL = 200;
const CACHE_LIMIT_SINGLE = 50;
const REFETCH_INTERVAL_MS = 2 * 60 * 1000; // 2 min
/** Cache older than this is ignored — ensures read status from Gmail/Zoho web syncs */
const CACHE_MAX_AGE_MS = 30 * 1000; // 30 sec

export const UNIFIED_VALUE = "__all__";

interface InboxCacheData {
  accountId: string;
  messages: InboxMessageListItem[];
  nextPageToken?: string;
  lastFetchedAt: number;
}

interface InboxContextValue {
  accountId: string;
  setAccountId: (id: string) => void;
  messages: InboxMessageListItem[];
  nextPageToken: string | undefined;
  loading: boolean;
  error: string | null;
  clearError: () => void;
  fetchInbox: (accountId: string) => Promise<void>;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  accountsList: Account[];
  activeAccounts: Account[];
}

const InboxContext = createContext<InboxContextValue | null>(null);

function loadCacheFromStorage(): InboxCacheData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CACHE);
    if (!raw) return null;
    const data = JSON.parse(raw) as InboxCacheData;
    if (!data?.accountId || !Array.isArray(data.messages)) return null;
    return data;
  } catch {
    return null;
  }
}

function saveCacheToStorage(data: InboxCacheData): void {
  try {
    const limit = data.accountId === UNIFIED_VALUE ? CACHE_LIMIT_ALL : CACHE_LIMIT_SINGLE;
    const toSave: InboxCacheData = {
      ...data,
      messages: data.messages.slice(0, limit),
    };
    localStorage.setItem(STORAGE_KEY_CACHE, JSON.stringify(toSave));
  } catch {
    // ignore
  }
}

export function InboxProvider({ children }: { children: ReactNode }) {
  const [accountId, setAccountIdState] = useState<string>("");
  const [messages, setMessages] = useState<InboxMessageListItem[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const accountIdRef = useRef(accountId);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  accountIdRef.current = accountId;

  const activeAccounts = accountsList.filter((a) => a.isActive);

  const setAccountId = useCallback((id: string) => {
    setAccountIdState(id);
    if (id) localStorage.setItem(STORAGE_KEY_LAST_ACCOUNT, id);
  }, []);

  const fetchInbox = useCallback(
    async (targetAccountId: string, pageToken?: string, append = false) => {
      setLoading(true);
      setError(null);
      try {
        const isUnified = targetAccountId === UNIFIED_VALUE;
        const limit = isUnified ? CACHE_LIMIT_ALL : CACHE_LIMIT_SINGLE;
        const fetcher = isUnified
          ? inbox.listAll({ limit, pageToken })
          : inbox.list(targetAccountId, { limit, pageToken });
        const res = await fetcher;
        if (accountIdRef.current !== targetAccountId) return;
        if (append) {
          setMessages((prev) => [...prev, ...res.messages]);
        } else {
          setMessages(res.messages);
        }
        setNextPageToken(res.nextPageToken ?? undefined);
        if (!append) {
          saveCacheToStorage({
            accountId: targetAccountId,
            messages: res.messages,
            nextPageToken: res.nextPageToken,
            lastFetchedAt: Date.now(),
          });
        }
      } catch (e) {
        console.error("Inbox fetch failed", e);
        const msg = e instanceof Error ? e.message : "Failed to load inbox";
        if (accountIdRef.current === targetAccountId) setError(msg);
      } finally {
        if (accountIdRef.current === targetAccountId) setLoading(false);
      }
    },
    []
  );

  const loadMore = useCallback(async () => {
    if (!accountId || !nextPageToken || loading) return;
    await fetchInbox(accountId, nextPageToken, true);
  }, [accountId, nextPageToken, loading, fetchInbox]);

  const refresh = useCallback(async () => {
    if (!accountId) return;
    await fetchInbox(accountId);
  }, [accountId, fetchInbox]);

  useEffect(() => {
    const lastId = localStorage.getItem(STORAGE_KEY_LAST_ACCOUNT);
    const initialId = lastId || UNIFIED_VALUE;
    setAccountIdState((prev) => (prev ? prev : initialId));
  }, []);

  useEffect(() => {
    accounts.list().then((list) => setAccountsList(list)).catch(console.error);
  }, []);

  useEffect(() => {
    if (!accountId) {
      setMessages([]);
      setNextPageToken(undefined);
      return;
    }
    const cached = loadCacheFromStorage();
    const cacheFresh =
      cached &&
      cached.accountId === accountId &&
      cached.messages.length > 0 &&
      Date.now() - (cached.lastFetchedAt ?? 0) < CACHE_MAX_AGE_MS;
    if (cacheFresh) {
      setMessages(cached.messages);
      setNextPageToken(cached.nextPageToken);
    } else {
      setMessages([]);
      setNextPageToken(undefined);
    }
    fetchInbox(accountId);
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    const onInboxUpdate = () => fetchInbox(accountId);
    const onFocus = () => fetchInbox(accountId);
    window.addEventListener("inbox-update", onInboxUpdate);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("inbox-update", onInboxUpdate);
      window.removeEventListener("focus", onFocus);
    };
  }, [accountId, fetchInbox]);

  useEffect(() => {
    if (!accountId) return;
    intervalRef.current = setInterval(() => {
      fetchInbox(accountId);
    }, REFETCH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [accountId, fetchInbox]);

  const value: InboxContextValue = {
    accountId,
    setAccountId,
    messages,
    nextPageToken,
    loading,
    error,
    clearError: () => setError(null),
    fetchInbox,
    loadMore,
    refresh,
    accountsList,
    activeAccounts,
  };

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

export function useInbox(): InboxContextValue {
  const ctx = useContext(InboxContext);
  if (!ctx) throw new Error("useInbox must be used within InboxProvider");
  return ctx;
}
