import { useEffect, useState } from "react";
import { accounts, auth } from "../api";
import type { Account } from "../api";

function LimitInput({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <input
      type="number"
      min={1}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { const n = +v; if (n >= 1) onSave(n); else setV(String(value)); }}
      style={{ width: 70, padding: "0.25rem", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 4, color: "#e4e4e7" }}
    />
  );
}

export default function Accounts() {
  const [list, setList] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    email: "",
    displayName: "",
    accountType: "zoho" as "google" | "zoho",
    dailyLimit: 100,
    smtpPassword: "",
    zohoProServers: true,
  });

  const load = () => accounts.list().then(setList).finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const connectGoogle = async () => {
    const { url } = await auth.getGoogleUrl(window.location.origin);
    window.open(url, "_blank", "width=500,height=600");
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "google-oauth-done") {
        window.removeEventListener("message", handler);
        load();
      }
    };
    window.addEventListener("message", handler);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.accountType === "zoho" && !form.smtpPassword) {
      alert("App Password required for Zoho");
      return;
    }
    try {
      await accounts.create({
        ...form,
        smtpPassword: form.accountType === "zoho" ? form.smtpPassword : undefined,
        zohoProServers: form.accountType === "zoho" ? form.zohoProServers : undefined,
      });
      setForm({ email: "", displayName: "", accountType: "zoho", dailyLimit: 100, smtpPassword: "", zohoProServers: true });
      setShowForm(false);
      load();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const updateLimit = async (id: string, dailyLimit: number) => {
    try {
      await accounts.update(id, { dailyLimit });
      load();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this account?")) return;
    try {
      await accounts.delete(id);
      load();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  return (
    <div>
      <h1 style={{ margin: "0 0 1.5rem", fontSize: "1.75rem" }}>Email Accounts</h1>
      <div style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem" }}>
        <button
          onClick={connectGoogle}
          style={{
            padding: "0.5rem 1rem",
            background: "#7c3aed",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontWeight: 500,
          }}
        >
          Connect Google
        </button>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{
            padding: "0.5rem 1rem",
            background: "#27272a",
            color: "white",
            border: "1px solid #3f3f46",
            borderRadius: 6,
            fontWeight: 500,
          }}
        >
          Add Zoho
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} style={{ background: "#18181b", padding: "1.5rem", borderRadius: 8, marginBottom: "1.5rem", border: "1px solid #27272a" }}>
          <h3 style={{ margin: "0 0 1rem" }}>Add Zoho Account</h3>
          <div style={{ display: "grid", gap: "0.75rem", maxWidth: 400 }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem" }}>Email</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                style={{ width: "100%", padding: "0.5rem", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                id="zohoPro"
                checked={form.zohoProServers}
                onChange={(e) => setForm({ ...form, zohoProServers: e.target.checked })}
              />
              <label htmlFor="zohoPro" style={{ fontSize: "0.875rem" }}>Custom domain (smtppro/imappro)</label>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem" }}>App Password</label>
              <input
                type="password"
                required
                value={form.smtpPassword}
                onChange={(e) => setForm({ ...form, smtpPassword: e.target.value })}
                placeholder="Generate in Zoho Mail settings"
                style={{ width: "100%", padding: "0.5rem", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }}
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem" }}>Daily Limit</label>
              <input
                type="number"
                min={1}
                value={form.dailyLimit}
                onChange={(e) => setForm({ ...form, dailyLimit: +e.target.value })}
                style={{ width: "100%", padding: "0.5rem", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }}
              />
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="submit" style={{ padding: "0.5rem 1rem", background: "#7c3aed", color: "white", border: "none", borderRadius: 6 }}>Add</button>
              <button type="button" onClick={() => setShowForm(false)} style={{ padding: "0.5rem 1rem", background: "#27272a", color: "white", border: "1px solid #3f3f46", borderRadius: 6 }}>Cancel</button>
            </div>
          </div>
        </form>
      )}

      <div style={{ background: "#18181b", borderRadius: 8, border: "1px solid #27272a", overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: "2rem", color: "#71717a" }}>Loading...</div>
        ) : list.length === 0 ? (
          <div style={{ padding: "2rem", color: "#71717a" }}>No accounts. Add Google or Zoho.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#27272a" }}>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>Email</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>Type</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>Daily Limit</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>Sent Today</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}></th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} style={{ borderTop: "1px solid #27272a" }}>
                  <td style={{ padding: "0.75rem 1rem" }}>{a.email}</td>
                  <td style={{ padding: "0.75rem 1rem" }}>{a.accountType}</td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <LimitInput value={a.dailyLimit} onSave={(v) => updateLimit(a.id, v)} />
                  </td>
                  <td style={{ padding: "0.75rem 1rem" }}>{a.sentToday}</td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <button onClick={() => remove(a.id)} style={{ padding: "0.25rem 0.5rem", background: "#7f1d1d", color: "white", border: "none", borderRadius: 4, fontSize: "0.875rem" }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
