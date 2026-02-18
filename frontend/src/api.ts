const API = (import.meta.env.VITE_API_URL as string | undefined)?.trim() || "/api";

export async function fetchApi<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const accounts = {
  list: () => fetchApi<Account[]>("/accounts"),
  create: (data: Partial<Account> & { accountType: string; email: string; smtpPassword?: string; zohoProServers?: boolean }) =>
    fetchApi<Account>("/accounts", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Account>) =>
    fetchApi<Account>(`/accounts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) => fetchApi<void>(`/accounts/${id}`, { method: "DELETE" }),
};

export const auth = {
  getGoogleUrl: (origin?: string) =>
    fetchApi<{ url: string }>(`/auth/google/url${origin ? `?origin=${encodeURIComponent(origin)}` : ""}`),
  googleCallback: (code: string, accountId?: string, redirectUri?: string) =>
    fetchApi<{ success: boolean; accountId: string; email: string }>("/auth/google/callback", {
      method: "POST",
      body: JSON.stringify({ code, accountId, redirectUri }),
    }),
};

export interface UpdateCampaign {
  name?: string;
  dailyLimit?: number;
  status?: string;
  startTime?: string;
  workingHoursStart?: string;
  workingHoursEnd?: string;
  accountIds?: string[];
  sequence?: {
    throttleMinMinutes?: number;
    throttleMaxMinutes?: number;
    steps?: { subjectTemplate: string; bodyTemplate: string; delayAfterPreviousDays?: number }[];
  };
}

export const campaigns = {
  list: () => fetchApi<Campaign[]>("/campaigns"),
  get: (id: string) => fetchApi<Campaign>(`/campaigns/${id}`),
  create: (data: CreateCampaign) => fetchApi<Campaign>("/campaigns", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: UpdateCampaign) =>
    fetchApi<Campaign>(`/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) => fetchApi<void>(`/campaigns/${id}`, { method: "DELETE" }),
};

export type UploadFilter = "all" | "exclude_risky" | "exclude_invalid_and_risky";

export const leads = {
  list: (campaignId: string) => fetchApi<Lead[]>(`/leads?campaignId=${campaignId}`),
  validkitAvailable: () => fetchApi<{ available: boolean }>("/leads/validkit-available"),
  validkitUsage: () => fetchApi<{ keys: { keyIndex: number; keyLabel: string; usedThisMonth: number; remaining: number; resetDay: number; lastResetAt: string }[] }>("/leads/validkit-usage"),
  preview: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(`${API}/leads/preview`, { method: "POST", body: fd }).then((r) => {
      if (!r.ok) return r.json().then((e) => { throw new Error(e.error); });
      return r.json();
    }) as Promise<{ totalRows: number; emails: string[]; emailCol: string }>;
  },
  validate: (emails: string[]) =>
    fetchApi<{ results: { email: string; status: string }[]; summary: { valid: number; invalid: number; risky: number } }>("/leads/validate", {
      method: "POST",
      body: JSON.stringify({ emails }),
    }),
  upload: (campaignId: string, file: File, opts?: { filter?: UploadFilter; validationResults?: { email: string; status: string }[] }) => {
    const fd = new FormData();
    fd.append("campaignId", campaignId);
    fd.append("file", file);
    if (opts?.filter) fd.append("filter", opts.filter);
    if (opts?.validationResults?.length) {
      const json = JSON.stringify(opts.validationResults);
      if (json.length > 4 * 1024 * 1024) {
        return Promise.reject(new Error("Validation results too large (max 4 MB). Try uploading in smaller batches."));
      }
      fd.append("validationResults", json);
    }
    return fetch(`${API}/leads/upload`, { method: "POST", body: fd }).then(async (r) => {
      const contentType = r.headers.get("content-type") || "";
      const isJson = contentType.includes("application/json");
      if (!r.ok) {
        const msg = isJson ? (await r.json().catch(() => ({}))).error : `Server error ${r.status}. Response may not be JSON.`;
        throw new Error(msg || String(r.status));
      }
      return isJson ? r.json() : { total: 0, created: 0, skipped: 0 };
    }) as Promise<{ total: number; created: number; skipped: number }>;
  },
  delete: (id: string) => fetchApi<void>(`/leads/${id}`, { method: "DELETE" }),
  move: (fromCampaignId: string, toCampaignId: string, onlyUnsent?: boolean) =>
    fetchApi<{ moved: number; skipped: number; message?: string }>("/leads/move", {
      method: "POST",
      body: JSON.stringify({ fromCampaignId, toCampaignId, onlyUnsent }),
    }),
};

export const history = {
  list: (params?: { campaignId?: string; accountId?: string; status?: string }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return fetchApi<SentEmail[]>(`/history${q ? `?${q}` : ""}`);
  },
};

export const stats = {
  dashboard: () => fetchApi<{ campaigns: number; accounts: number; totalSent: number; totalReplied: number }>("/stats/dashboard"),
};

export interface Account {
  id: string;
  email: string;
  displayName: string | null;
  accountType: "google" | "zoho";
  dailyLimit: number;
  sentToday: number;
  isActive: boolean;
  createdAt: string;
}

export interface SequenceStep {
  id: string;
  stepOrder: number;
  subjectTemplate: string;
  bodyTemplate: string;
  delayAfterPreviousDays: number;
}

export interface Sequence {
  id: string;
  throttleMinMinutes: number;
  throttleMaxMinutes: number;
  steps: SequenceStep[];
}

export interface Campaign {
  id: string;
  name: string;
  dailyLimit: number;
  status: string;
  startTime: string | null;
  workingHoursStart: string;
  workingHoursEnd: string;
  createdAt: string;
  sequence?: Sequence;
  campaignAccounts?: { account: Account }[];
  _count?: { leads: number };
  completionPercent?: number;
}

export interface CreateCampaign {
  name: string;
  dailyLimit?: number;
  startTime?: string | null;
  workingHoursStart?: string;
  workingHoursEnd?: string;
  accountIds?: string[];
  sequence?: {
    throttleMinMinutes?: number;
    throttleMaxMinutes?: number;
    steps: { subjectTemplate: string; bodyTemplate: string; delayAfterPreviousDays?: number }[];
  };
}

export interface Lead {
  id: string;
  email: string;
  data: string;
  status: string;
  currentStep: number;
  assignedAccountId: string | null;
  account?: Account;
}

export interface SentEmail {
  id: string;
  leadId: string;
  accountId: string;
  campaignId: string;
  stepOrder: number;
  subject: string;
  bodyPreview: string | null;
  sentAt: string;
  status: string;
  replyBody?: string | null;
  replyAt?: string | null;
  replyType?: string | null;
  lead?: Lead;
  account?: Account;
  campaign?: Campaign;
}
