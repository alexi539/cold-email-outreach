import { useEffect, useState, useMemo, type ReactNode } from "react";
import { RichTextEditor } from "../components/RichTextEditor";
import { useParams, useNavigate } from "react-router-dom";
import { GMAIL_MAX_MESSAGE_BYTES, EMAIL_MAX_SUBJECT_CHARS, getUtf8ByteLength } from "../lib/emailLimits";
import { campaigns, accounts, leads } from "../api";
import type { Campaign, Account, UpdateCampaign } from "../api";
import type { UploadFilter } from "../api";

type Tab = "settings" | "leads";

export default function CampaignEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("settings");
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [leadsList, setLeadsList] = useState<Awaited<ReturnType<typeof leads.list>>>([]);
  const [accountList, setAccountList] = useState<Account[]>([]);
  const [loading, setLoading] = useState(!!id);
  const [uploading, setUploading] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [previewStep, setPreviewStep] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: "",
    dailyLimit: 500,
    startImmediately: false,
    startTime: "09:00",
    workingHoursStart: "09:00",
    workingHoursEnd: "18:00",
    accountIds: [] as string[],
    throttleMin: 2,
    throttleMax: 5,
    steps: [
      { subjectTemplate: "", bodyTemplate: "", delayAfterPreviousDays: 0 },
    ] as { subjectTemplate: string; bodyTemplate: string; delayAfterPreviousDays: number }[],
  });

  useEffect(() => {
    accounts.list().then(setAccountList).catch(console.error);
    if (id) {
      campaigns.get(id).then((c) => {
        setCampaign(c);
        setForm({
          name: c.name,
          dailyLimit: c.dailyLimit,
          startImmediately: !c.startTime || c.startTime === "",
          startTime: c.startTime || "09:00",
          workingHoursStart: c.workingHoursStart || "09:00",
          workingHoursEnd: c.workingHoursEnd || "18:00",
          accountIds: c.campaignAccounts?.map((ca) => ca.account.id) ?? [],
          throttleMin: c.sequence?.throttleMinMinutes ?? 2,
          throttleMax: c.sequence?.throttleMaxMinutes ?? 5,
          steps: c.sequence?.steps?.length
            ? c.sequence.steps.map((s) => ({
                subjectTemplate: s.subjectTemplate,
                bodyTemplate: s.bodyTemplate,
                delayAfterPreviousDays: s.delayAfterPreviousDays,
              }))
            : [{ subjectTemplate: "", bodyTemplate: "", delayAfterPreviousDays: 0 }],
        });
      }).catch(console.error).finally(() => setLoading(false));
      leads.list(id).then(setLeadsList).catch(console.error);
    } else {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id && tab === "leads") {
      leads.list(id).then(setLeadsList).catch(console.error);
    }
  }, [id, tab, campaign?._count?.leads]);

  const validateForm = (): string | null => {
    const validateTime = (v: string, name: string): string | null => {
      if (!v?.trim()) return null;
      const parts = v.trim().split(":");
      const h = parseInt(parts[0], 10);
      const m = parts[1] !== undefined ? parseInt(parts[1], 10) : 0;
      if (isNaN(h)) return `${name}: use HH:mm (e.g. 09:00)`;
      if (parts[1] !== undefined && isNaN(m)) return `${name}: invalid minutes`;
      if (h < 0 || h > 23) return `${name}: hours must be 0–23 (24h in a day)`;
      if (m < 0 || m > 59) return `${name}: minutes must be 0–59`;
      return null;
    };
    if (!form.startImmediately && form.startTime) {
      const e = validateTime(form.startTime, "Start time");
      if (e) return e;
    }
    const e1 = validateTime(form.workingHoursStart, "Working hours start");
    if (e1) return e1;
    const e2 = validateTime(form.workingHoursEnd, "Working hours end");
    if (e2) return e2;
    if (form.dailyLimit < 1) return "Daily limit must be at least 1";
    if (form.throttleMin < 1 || form.throttleMax < 1) return "Throttle must be at least 1 minute";
    if (form.throttleMin > form.throttleMax) return "Throttle min cannot be greater than max";
    for (let i = 0; i < form.steps.length; i++) {
      const d = form.steps[i].delayAfterPreviousDays;
      if (d < 0) return `Follow-up ${i + 1}: delay must be 0 or more days`;
      const step = form.steps[i];
      if (step.subjectTemplate.length > EMAIL_MAX_SUBJECT_CHARS) {
        return `Step ${i + 1}: subject must be ≤ ${EMAIL_MAX_SUBJECT_CHARS} characters (Gmail/RFC limit)`;
      }
      const bodyBytes = getUtf8ByteLength(step.bodyTemplate);
      if (bodyBytes > GMAIL_MAX_MESSAGE_BYTES) {
        return `Step ${i + 1}: body exceeds Gmail limit (${(bodyBytes / (1024 * 1024)).toFixed(1)} MB > 25 MB)`;
      }
    }
    return null;
  };

  const save = async () => {
    const validationError = validateForm();
    if (validationError) {
      alert(validationError);
      return;
    }
    if (!id) return;
    try {
      const payload = {
        name: form.name.trim() || "Untitled Campaign",
        dailyLimit: form.dailyLimit,
        startTime: form.startImmediately ? null : form.startTime,
        workingHoursStart: form.workingHoursStart,
        workingHoursEnd: form.workingHoursEnd,
        accountIds: form.accountIds,
        sequence: {
          throttleMinMinutes: form.throttleMin,
          throttleMaxMinutes: form.throttleMax,
          steps: form.steps,
        },
      };
      await campaigns.update(id, payload as UpdateCampaign);
      const c = await campaigns.get(id);
      setCampaign(c);
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2500);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const setStatus = async (status: string) => {
    if (!id) return;
    try {
      await campaigns.update(id, { status });
      const c = await campaigns.get(id);
      setCampaign(c);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const onFileUpload = async (
    file: File,
    filter?: UploadFilter,
    validationResults?: { email: string; status: string }[],
  ) => {
    if (!id) return;
    setUploading(true);
    try {
      const result = await leads.upload(id, file, { filter, validationResults });
      const c = await campaigns.get(id);
      setCampaign(c);
      await leads.list(id).then(setLeadsList);
      alert(`Uploaded: ${result.created} new leads, ${result.skipped} skipped (duplicates)`);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const toggleAccount = (accountId: string) => {
    setForm((f) => ({
      ...f,
      accountIds: f.accountIds.includes(accountId)
        ? f.accountIds.filter((x) => x !== accountId)
        : [...f.accountIds, accountId],
    }));
  };

  if (loading) return <div style={{ color: "#71717a" }}>Loading...</div>;

  return (
    <div>
      <h1 style={{ margin: "0 0 0.5rem", fontSize: "1.75rem" }}>{campaign?.name ?? "Edit"}</h1>
      {campaign && (
        <div style={{ marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: "1rem" }}>
          <span style={{ fontSize: "0.875rem", color: "#a1a1aa" }}>Progress: {campaign.completionPercent ?? 0}%</span>
          <div style={{ flex: 1, maxWidth: 200, height: 8, background: "#27272a", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${campaign.completionPercent ?? 0}%`, height: "100%", background: "#7c3aed", transition: "width 0.2s" }} />
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem", alignItems: "center" }}>
        {id && (
          <div style={{ display: "flex", gap: "0.25rem" }}>
            <button onClick={() => setTab("settings")} style={{ padding: "0.5rem 1rem", background: tab === "settings" ? "#7c3aed" : "#27272a", color: "white", border: "none", borderRadius: 6 }}>Settings</button>
            <button onClick={() => setTab("leads")} style={{ padding: "0.5rem 1rem", background: tab === "leads" ? "#7c3aed" : "#27272a", color: "white", border: "none", borderRadius: 6 }}>Leads</button>
          </div>
        )}
        {id && campaign && (
          <>
            {campaign.status === "draft" && (
              <button
                onClick={() => {
                  const accountCount = campaign.campaignAccounts?.length ?? 0;
                  const leadCount = campaign._count?.leads ?? 0;
                  if (accountCount === 0) {
                    alert("Add at least one email account in Settings and click Save before starting.");
                    return;
                  }
                  if (leadCount === 0) {
                    alert("Upload leads in the Leads tab before starting.");
                    return;
                  }
                  setStatus("active");
                }}
                style={{ padding: "0.5rem 1rem", background: "#166534", color: "white", border: "none", borderRadius: 6 }}
              >
                Start
              </button>
            )}
            {(campaign.status === "active" || campaign.status === "paused") && (
              <button onClick={() => setStatus(campaign.status === "active" ? "paused" : "active")} style={{ padding: "0.5rem 1rem", background: campaign.status === "active" ? "#854d0e" : "#166534", color: "white", border: "none", borderRadius: 6 }}>
                {campaign.status === "active" ? "Pause" : "Resume"}
              </button>
            )}
          </>
        )}
      </div>

      {tab === "leads" ? (
        <LeadsTab
          campaign={campaign}
          leadsList={leadsList}
          uploading={uploading}
          onUpload={onFileUpload}
          onLeadDelete={async (leadId) => {
            await leads.delete(leadId);
            if (id) {
              const [nextLeads, nextCampaign] = await Promise.all([leads.list(id), campaigns.get(id)]);
              setLeadsList(nextLeads);
              setCampaign(nextCampaign);
            }
          }}
          onRefresh={async () => {
            if (id) {
              const [nextLeads, nextCampaign] = await Promise.all([leads.list(id), campaigns.get(id)]);
              setLeadsList(nextLeads);
              setCampaign(nextCampaign);
            }
          }}
        />
      ) : (
      <div style={{ maxWidth: 700, display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {id && (
          <SendCapacityEstimator
            form={form}
            accountList={accountList}
            leadsList={leadsList}
            stepsCount={form.steps.length}
          />
        )}
        <Section title="Basic">
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem" }}>Name (optional)</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Untitled Campaign"
                style={{ width: "100%", padding: "0.5rem", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }}
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem" }}>Daily Limit (campaign)</label>
              <input
                type="number"
                min={1}
                value={form.dailyLimit}
                onChange={(e) => setForm({ ...form, dailyLimit: +e.target.value })}
                style={{ width: 120, padding: "0.5rem", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }}
              />
            </div>
            <div>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", marginBottom: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={form.startImmediately}
                  onChange={(e) => setForm({ ...form, startImmediately: e.target.checked })}
                />
                <span style={{ fontSize: "0.875rem" }}>Start immediately</span>
              </label>
              {!form.startImmediately && (
                <div>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem" }}>Start Time (MSK)</label>
                  <input
                    type="text"
                    value={form.startTime}
                    onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                    placeholder="09:00"
                    style={{ width: 80, padding: "0.5rem", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }}
                  />
                </div>
              )}
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem" }}>Working Hours (MSK)</label>
              <span style={{ marginRight: "0.5rem" }}>
                <input
                  type="text"
                  value={form.workingHoursStart}
                  onChange={(e) => setForm({ ...form, workingHoursStart: e.target.value })}
                  placeholder="09:00"
                  style={{ width: 70, padding: "0.5rem", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }}
                />
                —
                <input
                  type="text"
                  value={form.workingHoursEnd}
                  onChange={(e) => setForm({ ...form, workingHoursEnd: e.target.value })}
                  placeholder="18:00"
                  style={{ width: 70, padding: "0.5rem", marginLeft: "0.25rem", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }}
                />
              </span>
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "#71717a" }}>
                Overnight range supported: 09:00–03:00 = 9 AM to 3 AM next day
              </p>
              {(campaign?.status === "active" || campaign?.status === "paused") && (
                <p style={{ margin: "0.5rem 0 0", fontSize: "0.75rem", color: "#a78bfa" }}>
                  Emails send only during working hours (MSK). Current MSK: {new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" })}
                </p>
              )}
            </div>
          </div>
        </Section>

        <Section title="Email Accounts">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {accountList.map((a) => (
              <label key={a.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={form.accountIds.includes(a.id)}
                  onChange={() => toggleAccount(a.id)}
                />
                <span>{a.email}</span>
              </label>
            ))}
            {accountList.length === 0 && <span style={{ color: "#71717a" }}>No accounts. Add some first.</span>}
          </div>
        </Section>

        <Section title="Throttle (min between sends)">
          <span style={{ marginRight: "0.5rem" }}>
            <input
              type="number"
              min={1}
              value={form.throttleMin}
              onChange={(e) => setForm({ ...form, throttleMin: +e.target.value })}
              style={{ width: 60, padding: "0.5rem", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }}
            />
            —
            <input
              type="number"
              min={1}
              value={form.throttleMax}
              onChange={(e) => setForm({ ...form, throttleMax: +e.target.value })}
              style={{ width: 60, padding: "0.5rem", marginLeft: "0.25rem", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }}
            />
          </span>
          <span style={{ fontSize: "0.875rem", color: "#71717a" }}> minutes (random)</span>
        </Section>

        <Section title="Sequence">
          <p style={{ fontSize: "0.875rem", color: "#71717a", marginBottom: "1rem" }}>
            Use <strong style={{ color: "#a78bfa" }}>{"{{"}name{"}}"}</strong>, <strong style={{ color: "#a78bfa" }}>{"{{"}company{"}}"}</strong> etc. — double curly braces, column names from your CSV (case-sensitive). Possessive: <strong style={{ color: "#a78bfa" }}>{"{{Name's}}"}</strong> → John's.
          </p>
          {(campaign?.status === "active" || campaign?.status === "paused") && (
            <p style={{ fontSize: "0.875rem", color: "#a78bfa", marginBottom: "1rem" }}>
              Edits apply to emails not yet sent. Already-sent emails keep their content and status.
            </p>
          )}
          {form.steps.map((step, i) => (
            <div key={i} style={{ marginBottom: "1.5rem", padding: "1.25rem", background: "#27272a", borderRadius: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                <h4 style={{ margin: 0 }}>{i === 0 ? "Initial Email" : "Follow-up " + i}</h4>
                {i > 0 && i === form.steps.length - 1 && (
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, steps: form.steps.slice(0, -1) })}
                    style={{ padding: "0.25rem 0.5rem", background: "#7f1d1d", color: "white", border: "none", borderRadius: 4, fontSize: "0.875rem" }}
                  >
                    Remove last follow-up
                  </button>
                )}
              </div>
              {i > 0 && (
                <div style={{ marginBottom: "0.5rem" }}>
                  <label style={{ fontSize: "0.875rem" }}>Delay after previous: </label>
                  <input
                    type="number"
                    min={0}
                    value={step.delayAfterPreviousDays}
                    onChange={(e) => {
                      const s = [...form.steps];
                      s[i] = { ...s[i], delayAfterPreviousDays: +e.target.value };
                      setForm({ ...form, steps: s });
                    }}
                    style={{ width: 50, padding: "0.25rem", background: "#18181b", border: "1px solid #3f3f46", borderRadius: 4, color: "#e4e4e7" }}
                  />
                  <span style={{ marginLeft: "0.25rem", fontSize: "0.875rem" }}>days</span>
                </div>
              )}
              <div style={{ marginBottom: "0.5rem" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem" }}>Subject</label>
                <input
                  value={step.subjectTemplate}
                  onChange={(e) => {
                    const s = [...form.steps];
                    s[i] = { ...s[i], subjectTemplate: e.target.value };
                    setForm({ ...form, steps: s });
                  }}
                  maxLength={EMAIL_MAX_SUBJECT_CHARS}
                  title={`Max ${EMAIL_MAX_SUBJECT_CHARS} characters (email standard)`}
                  style={{ width: "100%", padding: "0.5rem", background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem" }}>Body</label>
                <RichTextEditor
                  value={step.bodyTemplate}
                  onChange={(html) => {
                    const s = [...form.steps];
                    s[i] = { ...s[i], bodyTemplate: html };
                    setForm({ ...form, steps: s });
                  }}
                  placeholder="Write your email..."
                />
                <button
                  type="button"
                  onClick={() => setPreviewStep(i)}
                  style={{ marginTop: "0.5rem", padding: "0.375rem 0.75rem", background: "#27272a", color: "#a78bfa", border: "1px solid #3f3f46", borderRadius: 6, fontSize: "0.875rem" }}
                >
                  Preview
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setForm({ ...form, steps: [...form.steps, { subjectTemplate: "", bodyTemplate: "", delayAfterPreviousDays: 3 }] })}
            style={{ padding: "0.5rem 1rem", background: "#27272a", color: "#a78bfa", border: "1px dashed #7c3aed", borderRadius: 6, fontWeight: 500 }}
          >
            + Add follow-up
          </button>
        </Section>

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button onClick={save} style={{ padding: "0.5rem 1rem", background: "#7c3aed", color: "white", border: "none", borderRadius: 6 }}>Save</button>
          {savedAt && (
            <span style={{ color: "#22c55e", fontSize: "0.875rem", fontWeight: 500 }}>Saved</span>
          )}
          {id && <button onClick={() => navigate('/campaigns')} style={{ padding: "0.5rem 1rem", background: "#27272a", color: "white", border: "1px solid #3f3f46", borderRadius: 6 }}>Back</button>}
        </div>
      </div>
      )}

      {previewStep !== null && (
        <EmailPreviewModal
          step={form.steps[previewStep]}
          stepLabel={previewStep === 0 ? "Initial Email" : `Follow-up ${previewStep}`}
          leadsList={leadsList}
          campaignAccounts={campaign?.campaignAccounts?.map((ca) => ca.account) ?? accountList.filter((a) => form.accountIds.includes(a.id))}
          onClose={() => setPreviewStep(null)}
        />
      )}
    </div>
  );
}

function personalize(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const trimmed = key.trim();
    const possessiveMatch = trimmed.match(/^(.+?)'s$/);
    if (possessiveMatch) {
      const baseKey = possessiveMatch[1].trim();
      const val = data[baseKey];
      return val != null ? String(val) + "'s" : "";
    }
    const val = data[trimmed];
    return val != null ? String(val) : "";
  });
}

function EmailPreviewModal({
  step,
  stepLabel,
  leadsList,
  campaignAccounts,
  onClose,
}: {
  step: { subjectTemplate: string; bodyTemplate: string };
  stepLabel: string;
  leadsList: Awaited<ReturnType<typeof leads.list>>;
  campaignAccounts: Account[];
  onClose: () => void;
}) {
  const [recipientId, setRecipientId] = useState<string>("");
  const [senderId, setSenderId] = useState<string>("");

  const recipient = leadsList.find((l) => l.id === recipientId) ?? leadsList[0];
  const sender = campaignAccounts.find((a) => a.id === senderId) ?? campaignAccounts[0];

  const data = (() => {
    try {
      return (JSON.parse(recipient?.data || "{}") as Record<string, string>) || {};
    } catch {
      return {};
    }
  })();

  const subject = personalize(step.subjectTemplate, data);
  const body = personalize(step.bodyTemplate, data);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#18181b",
          borderRadius: 12,
          border: "1px solid #27272a",
          maxWidth: 560,
          width: "90%",
          maxHeight: "90vh",
          overflow: "auto",
          padding: "1.5rem",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 1rem", fontSize: "1.125rem" }}>Preview: {stepLabel}</h3>

        <div style={{ display: "grid", gap: "1rem", marginBottom: "1.5rem" }}>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", color: "#a1a1aa" }}>Recipient (for personalization)</label>
            <select
              value={recipientId || recipient?.id || ""}
              onChange={(e) => setRecipientId(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }}
            >
              {leadsList.length === 0 ? (
                <option value="">No leads — upload CSV first</option>
              ) : (
                leadsList.map((l) => {
                  const d = (() => { try { return JSON.parse(l.data || "{}"); } catch { return {}; } })() as Record<string, string>;
                  const email = d.email ?? d.Email ?? l.email;
                  const name = d.name ?? d.Name ?? email;
                  return (
                    <option key={l.id} value={l.id}>
                      {name} &lt;{email}&gt;
                    </option>
                  );
                })
              )}
            </select>
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", color: "#a1a1aa" }}>Sender (From)</label>
            <select
              value={senderId || sender?.id || ""}
              onChange={(e) => setSenderId(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }}
            >
              {campaignAccounts.length === 0 ? (
                <option value="">No accounts in campaign</option>
              ) : (
                campaignAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName || a.email} &lt;{a.email}&gt;
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        <div style={{ background: "#27272a", borderRadius: 8, padding: "1rem", border: "1px solid #3f3f46" }}>
          <div style={{ marginBottom: "0.75rem", fontSize: "0.75rem", color: "#71717a" }}>
            From: {sender?.displayName || sender?.email} &lt;{sender?.email}&gt;
          </div>
          <div style={{ marginBottom: "0.75rem", fontSize: "0.75rem", color: "#71717a" }}>
            To: {data.email ?? data.Email ?? recipient?.email ?? "—"}
          </div>
          <div style={{ marginBottom: "0.75rem", fontSize: "0.875rem", fontWeight: 600 }}>Subject: {subject || "(no subject)"}</div>
          <div
            style={{ fontSize: "0.875rem", lineHeight: 1.5 }}
            dangerouslySetInnerHTML={{ __html: body?.trim().startsWith("<") ? body : `<p>${(body || "(empty)").replace(/\n/g, "<br>")}</p>` }}
          />
        </div>

        <button
          onClick={onClose}
          style={{ marginTop: "1rem", padding: "0.5rem 1rem", background: "#27272a", color: "white", border: "1px solid #3f3f46", borderRadius: 6 }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

/** Parse HH:mm to minutes from midnight. Returns null if invalid. */
function parseTimeToMinutes(s: string): number | null {
  const parts = s.trim().split(":");
  const h = parseInt(parts[0], 10);
  const m = parts[1] !== undefined ? parseInt(parts[1], 10) : 0;
  if (isNaN(h) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/** Working hours duration in minutes (supports overnight, e.g. 22:00–06:00). */
function workingHoursMinutes(start: string, end: string): number | null {
  const sm = parseTimeToMinutes(start);
  const em = parseTimeToMinutes(end);
  if (sm == null || em == null) return null;
  if (sm <= em) return em - sm;
  return 24 * 60 - sm + em;
}

function SendCapacityEstimator({
  form,
  accountList,
  leadsList,
  stepsCount,
}: {
  form: { dailyLimit: number; workingHoursStart: string; workingHoursEnd: string; accountIds: string[]; throttleMin: number; throttleMax: number };
  accountList: Account[];
  leadsList: Awaited<ReturnType<typeof leads.list>>;
  stepsCount: number;
}) {
  const estimate = useMemo(() => {
    const wh = workingHoursMinutes(form.workingHoursStart, form.workingHoursEnd);
    const selected = accountList.filter((a) => form.accountIds.includes(a.id));
    const avgThrottle = (form.throttleMin + form.throttleMax) / 2;

    let throttleCapacity = 0;
    if (wh != null && wh > 0 && avgThrottle > 0 && selected.length > 0) {
      throttleCapacity = Math.floor((selected.length * wh) / avgThrottle);
    }

    const accountCapacity = selected.reduce(
      (sum, a) => sum + Math.max(0, (a.dailyLimit ?? 0) - (a.sentToday ?? 0)),
      0
    );
    const campaignLimit = Math.max(0, form.dailyLimit);

    const emailsPerDay = Math.min(
      throttleCapacity || Infinity,
      campaignLimit,
      accountCapacity || Infinity
    );
    const effectivePerDay = Number.isFinite(emailsPerDay) ? Math.floor(emailsPerDay) : 0;

    const activeLeads = leadsList.filter(
      (l) => (l.status === "pending" || l.status === "sent") && l.currentStep < stepsCount
    );
    const totalEmailsToSend = activeLeads.reduce(
      (sum, l) => sum + Math.max(0, stepsCount - l.currentStep),
      0
    );
    const daysToFinish =
      effectivePerDay > 0 && totalEmailsToSend > 0
        ? Math.ceil(totalEmailsToSend / effectivePerDay)
        : totalEmailsToSend > 0 ? null : 0;

    return {
      emailsPerDay: effectivePerDay,
      totalEmailsToSend,
      daysToFinish,
      throttleCapacity,
      campaignLimit,
      accountCapacity,
      hasValidTimes: wh != null && wh > 0,
      hasAccounts: selected.length > 0,
    };
  }, [form, accountList, leadsList, stepsCount]);

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #1e1b4b 0%, #18181b 100%)",
        padding: "1.25rem 1.5rem",
        borderRadius: 8,
        border: "1px solid #3f3f46",
      }}
    >
      <h3 style={{ margin: "0 0 1rem", fontSize: "0.9375rem", color: "#a1a1aa" }}>
        Send capacity
      </h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", alignItems: "baseline" }}>
        <div>
          <span style={{ fontSize: "1.5rem", fontWeight: 700, color: "#e4e4e7" }}>
            {estimate.hasValidTimes && estimate.hasAccounts
              ? estimate.emailsPerDay
              : "—"}
          </span>
          <span style={{ marginLeft: "0.35rem", fontSize: "0.875rem", color: "#71717a" }}>
            emails / day
          </span>
        </div>
        <div>
          <span style={{ fontSize: "1.5rem", fontWeight: 700, color: "#a78bfa" }}>
            {estimate.daysToFinish !== null
              ? estimate.daysToFinish
              : estimate.totalEmailsToSend > 0
                ? "∞"
                : "0"}
          </span>
          <span style={{ marginLeft: "0.35rem", fontSize: "0.875rem", color: "#71717a" }}>
            days to finish
          </span>
        </div>
      </div>
      <p style={{ margin: "0.5rem 0 0", fontSize: "0.75rem", color: "#71717a" }}>
        {estimate.totalEmailsToSend} emails left to send
        {estimate.hasValidTimes &&
          estimate.hasAccounts &&
          ` · limited by min(throttle: ${estimate.throttleCapacity}, campaign: ${estimate.campaignLimit}, accounts: ${estimate.accountCapacity})`}
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ background: "#18181b", padding: "1.5rem", borderRadius: 8, border: "1px solid #27272a" }}>
      <h3 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>{title}</h3>
      {children}
    </div>
  );
}

function LeadsTab({
  campaign,
  leadsList,
  uploading,
  onUpload,
  onLeadDelete,
  onRefresh,
}: {
  campaign: Campaign | null;
  leadsList: Awaited<ReturnType<typeof leads.list>>;
  uploading: boolean;
  onUpload: (file: File, filter?: UploadFilter, validationResults?: { email: string; status: string }[]) => Promise<void>;
  onLeadDelete?: (leadId: string) => Promise<void>;
  onRefresh?: () => Promise<void>;
}) {
  const [validkitAvailable, setValidkitAvailable] = useState(false);
  const [validkitUsage, setValidkitUsage] = useState<{ keyIndex: number; keyLabel: string; usedThisMonth: number; remaining: number; resetDay: number }[]>([]);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<{ totalRows: number; emails: string[] } | null>(null);
  const [validating, setValidating] = useState(false);
  const [campaignList, setCampaignList] = useState<Awaited<ReturnType<typeof campaigns.list>>>([]);
  const [moveToCampaignId, setMoveToCampaignId] = useState("");
  const [onlyUnsent, setOnlyUnsent] = useState(true);
  const [moving, setMoving] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    results: { email: string; status: string }[];
    summary: { valid: number; invalid: number; risky: number };
  } | null>(null);

  useEffect(() => {
    leads.validkitAvailable().then((r) => setValidkitAvailable(r.available)).catch(() => setValidkitAvailable(false));
  }, []);

  useEffect(() => {
    campaigns.list().then(setCampaignList).catch(() => setCampaignList([]));
  }, []);

  useEffect(() => {
    if (validkitAvailable) {
      leads.validkitUsage().then((r) => setValidkitUsage(r.keys)).catch(() => setValidkitUsage([]));
    }
  }, [validkitAvailable, validationResult]);

  if (!campaign) {
    return (
      <div style={{ background: "#18181b", padding: "2rem", borderRadius: 8, border: "1px solid #27272a" }}>
        <p style={{ color: "#71717a", margin: 0 }}>Campaign not found.</p>
      </div>
    );
  }

  const columns: string[] = [];
  if (leadsList.length > 0) {
    const allKeys = new Set<string>();
    for (const lead of leadsList) {
      try {
        const data = JSON.parse(lead.data || "{}") as Record<string, string>;
        Object.keys(data).forEach((k) => allKeys.add(k));
      } catch {}
    }
    const keys = Array.from(allKeys);
    if (keys.some((k) => k.toLowerCase() === "email")) {
      const emailKey = keys.find((k) => k.toLowerCase() === "email")!;
      columns.push(emailKey, ...keys.filter((k) => k !== emailKey));
    } else {
      columns.push(...keys);
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPreviewFile(file);
    setPreviewData(null);
    setValidationResult(null);
    try {
      const data = await leads.preview(file);
      setPreviewData({ totalRows: data.totalRows, emails: data.emails });
    } catch (err) {
      alert((err as Error).message);
      setPreviewFile(null);
    }
  };

  const handleValidate = async () => {
    if (!previewData?.emails.length || !previewFile) return;
    setValidating(true);
    setValidationResult(null);
    try {
      const res = await leads.validate(previewData.emails);
      setValidationResult(res);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setValidating(false);
    }
  };

  const handleUploadWithFilter = async (filter: UploadFilter) => {
    if (!previewFile) return;
    await onUpload(previewFile, filter, validationResult?.results);
    setPreviewFile(null);
    setPreviewData(null);
    setValidationResult(null);
  };

  const handleUploadWithoutValidation = async () => {
    if (!previewFile) return;
    await onUpload(previewFile, "all");
    setPreviewFile(null);
    setPreviewData(null);
    setValidationResult(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {validkitAvailable && validkitUsage.length > 0 && (
        <div style={{ background: "#18181b", padding: "1rem 1.5rem", borderRadius: 8, border: "1px solid #27272a" }}>
          <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.875rem" }}>ValidKit API Keys</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem 1rem", fontSize: "0.8125rem" }}>
            {validkitUsage.map((k) => (
              <span key={k.keyIndex} style={{ color: "#a1a1aa" }}>
                ...{k.keyLabel}: {k.usedThisMonth}/1000 used, {k.remaining} left (resets day {k.resetDay})
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ background: "#18181b", padding: "1.5rem", borderRadius: 8, border: "1px solid #27272a" }}>
        <h3 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>Upload CSV</h3>
        <p style={{ fontSize: "0.875rem", color: "#a1a1aa", marginBottom: "0.75rem" }}>
          First row = column names (email required). Rows below = data. Use {"{{"}name{"}}"}, {"{{"}company{"}}"} etc. (case-sensitive). Possessive: {"{{Name's}}"} → John's.
        </p>
        <div>
          <input
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            disabled={uploading || validating}
            style={{ marginRight: "0.5rem" }}
          />
          {(uploading || validating) && (
            <span style={{ color: "#71717a" }}>{validating ? "Validating..." : "Uploading..."}</span>
          )}
        </div>

        {previewData && previewFile && (
          <div style={{ marginTop: "1rem", padding: "1rem", background: "#27272a", borderRadius: 8 }}>
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.875rem" }}>
              Found <strong>{previewData.emails.length}</strong> emails in {previewData.totalRows} rows.
            </p>
            {!validationResult ? (
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                {validkitAvailable ? (
                  <button
                    onClick={handleValidate}
                    disabled={validating}
                    style={{ padding: "0.5rem 1rem", background: "#7c3aed", color: "white", border: "none", borderRadius: 6, cursor: validating ? "wait" : "pointer" }}
                  >
                    Validate emails
                  </button>
                ) : null}
                <button
                  onClick={handleUploadWithoutValidation}
                  disabled={uploading}
                  style={{ padding: "0.5rem 1rem", background: "#27272a", color: "#e4e4e7", border: "1px solid #3f3f46", borderRadius: 6, cursor: uploading ? "wait" : "pointer" }}
                >
                  Upload without validation
                </button>
              </div>
            ) : (
              <div>
                <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem" }}>
                  Valid: <span style={{ color: "#22c55e" }}>{validationResult.summary.valid}</span>
                  {" · "}
                  Invalid: <span style={{ color: "#ef4444" }}>{validationResult.summary.invalid}</span>
                  {" · "}
                  Risky: <span style={{ color: "#f59e0b" }}>{validationResult.summary.risky}</span>
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  <button
                    onClick={() => handleUploadWithFilter("exclude_invalid_and_risky")}
                    disabled={uploading}
                    style={{ padding: "0.5rem 1rem", background: "#166534", color: "white", border: "none", borderRadius: 6, cursor: uploading ? "wait" : "pointer" }}
                  >
                    Remove invalid & risky, upload {validationResult.summary.valid} valid
                  </button>
                  <button
                    onClick={() => handleUploadWithFilter("exclude_risky")}
                    disabled={uploading}
                    style={{ padding: "0.5rem 1rem", background: "#854d0e", color: "white", border: "none", borderRadius: 6, cursor: uploading ? "wait" : "pointer" }}
                  >
                    Remove risky only, upload {validationResult.summary.valid + validationResult.summary.invalid}
                  </button>
                  <button
                    onClick={() => handleUploadWithFilter("all")}
                    disabled={uploading}
                    style={{ padding: "0.5rem 1rem", background: "#27272a", color: "#e4e4e7", border: "1px solid #3f3f46", borderRadius: 6, cursor: uploading ? "wait" : "pointer" }}
                  >
                    Keep all, upload {previewData.emails.length}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {leadsList.length > 0 && campaign && (
        <div style={{ background: "#18181b", padding: "1.5rem", borderRadius: 8, border: "1px solid #27272a" }}>
          <h3 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>Move leads to another campaign</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem" }}>Target campaign</label>
              <select
                value={moveToCampaignId}
                onChange={(e) => setMoveToCampaignId(e.target.value)}
                style={{ padding: "0.5rem", minWidth: 200, background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }}
              >
                <option value="">— Select —</option>
                {campaignList
                  .filter((c) => c.id !== campaign.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>{c.name || "Untitled"}</option>
                  ))}
              </select>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", marginTop: "1.5rem" }}>
              <input type="checkbox" checked={onlyUnsent} onChange={(e) => setOnlyUnsent(e.target.checked)} />
              <span style={{ fontSize: "0.875rem" }}>Move only leads with 0 emails sent</span>
            </label>
            <div style={{ marginTop: "1.5rem" }}>
              {(() => {
                const count = onlyUnsent ? leadsList.filter((l) => l.currentStep === 0).length : leadsList.length;
                return (
                  <button
                    onClick={async () => {
                      if (!moveToCampaignId || !campaign.id) return;
                      if (count === 0) {
                        alert(onlyUnsent ? "No leads with 0 emails sent." : "No leads to move.");
                        return;
                      }
                      if (!confirm(`Move ${count} lead(s) to the selected campaign?`)) return;
                      setMoving(true);
                      try {
                        const res = await leads.move(campaign.id, moveToCampaignId, onlyUnsent);
                        alert(`Moved ${res.moved} lead(s).${res.skipped ? ` Skipped ${res.skipped} (duplicates).` : ""}`);
                        await onRefresh?.();
                        setMoveToCampaignId("");
                      } catch (err) {
                        alert((err as Error).message);
                      } finally {
                        setMoving(false);
                      }
                    }}
                    disabled={!moveToCampaignId || moving || count === 0}
                    style={{
                      padding: "0.5rem 1rem",
                      background: moveToCampaignId && count > 0 ? "#7c3aed" : "#27272a",
                      color: "white",
                      border: "none",
                      borderRadius: 6,
                      cursor: moveToCampaignId && count > 0 && !moving ? "pointer" : "not-allowed",
                    }}
                  >
                    {moving ? "Moving…" : `Move ${count} lead(s)`}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      <div style={{ background: "#18181b", borderRadius: 8, border: "1px solid #27272a", overflow: "auto" }}>
        <h3 style={{ margin: "0 0 1rem", padding: "1rem 1rem 0", fontSize: "1rem" }}>Leads ({campaign?._count?.leads ?? leadsList.length})</h3>
        {leadsList.length === 0 ? (
          <div style={{ padding: "2rem", color: "#71717a" }}>No leads. Upload a CSV file above.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#27272a" }}>
                {columns.map((col) => (
                  <th key={col} style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600, fontSize: "0.875rem" }}>
                    {col}
                    {col.toLowerCase() === "email" && " *"}
                  </th>
                ))}
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600, fontSize: "0.875rem" }}>Emails sent</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600, fontSize: "0.875rem" }}>Status</th>
                {onLeadDelete && <th style={{ padding: "0.75rem 1rem", textAlign: "right", fontWeight: 600, fontSize: "0.875rem", width: 80 }}></th>}
              </tr>
            </thead>
            <tbody>
              {leadsList.map((lead) => {
                const data = (() => { try { return JSON.parse(lead.data || "{}"); } catch { return {}; } })() as Record<string, string>;
                const totalSteps = campaign?.sequence?.steps?.length ?? 1;
                return (
                  <tr key={lead.id} style={{ borderTop: "1px solid #27272a" }}>
                    {columns.map((col) => (
                      <td key={col} style={{ padding: "0.5rem 1rem", fontSize: "0.875rem" }}>{data[col] ?? ""}</td>
                    ))}
                    <td style={{ padding: "0.5rem 1rem", fontSize: "0.875rem" }}>{lead.currentStep} / {totalSteps}</td>
                    <td style={{ padding: "0.5rem 1rem", fontSize: "0.875rem" }}>{lead.status}</td>
                    {onLeadDelete && (
                      <td style={{ padding: "0.5rem 1rem", textAlign: "right" }}>
                        <button
                          onClick={async () => {
                            if (!confirm("Delete this lead?")) return;
                            try {
                              await onLeadDelete(lead.id);
                            } catch (err) {
                              alert((err as Error).message);
                            }
                          }}
                          style={{ padding: "0.25rem 0.5rem", background: "#7f1d1d", color: "white", border: "none", borderRadius: 4, fontSize: "0.75rem", cursor: "pointer" }}
                        >
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
