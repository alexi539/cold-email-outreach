import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { campaigns } from "../api";
import type { Campaign } from "../api";

export default function Campaigns() {
  const navigate = useNavigate();
  const location = useLocation();
  const [list, setList] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState((location.state as { create?: boolean })?.create ?? false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    campaigns.list().then(setList).finally(() => setLoading(false));
  }, []);

  const createCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim() || "Untitled Campaign";
    setCreating(true);
    try {
      const c = await campaigns.create({
        name,
        dailyLimit: 500,
        startTime: null,
        workingHoursStart: "09:00",
        workingHoursEnd: "18:00",
        accountIds: [],
        sequence: {
          throttleMinMinutes: 2,
          throttleMaxMinutes: 5,
          steps: [{ subjectTemplate: "", bodyTemplate: "", delayAfterPreviousDays: 0 }],
        },
      });
      setShowCreate(false);
      setNewName("");
      navigate(`/campaigns/${c.id}`);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    const c = list.find((x) => x.id === id);
    const leadsCount = c?._count?.leads ?? 0;
    const msg = leadsCount > 0
      ? `This will permanently delete the campaign and all ${leadsCount} leads. This cannot be undone. Continue?`
      : "Delete this campaign?";
    if (!confirm(msg)) return;
    try {
      await campaigns.delete(id);
      setList((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      alert((err as Error).message);
    }
  };

  return (
    <div>
      <h1 style={{ margin: "0 0 1.5rem", fontSize: "1.75rem" }}>Campaigns</h1>
      {showCreate ? (
        <form onSubmit={createCampaign} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap" }}>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Campaign name"
            style={{ padding: "0.5rem 1rem", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7", minWidth: 200 }}
          />
          <button type="submit" disabled={creating} style={{ padding: "0.5rem 1rem", background: "#7c3aed", color: "white", border: "none", borderRadius: 6, fontWeight: 500 }}>
            {creating ? "Creating..." : "Create"}
          </button>
          <button type="button" onClick={() => { setShowCreate(false); setNewName(""); }} style={{ padding: "0.5rem 1rem", background: "#27272a", color: "white", border: "1px solid #3f3f46", borderRadius: 6 }}>
            Cancel
          </button>
        </form>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          style={{
            display: "inline-block",
            padding: "0.5rem 1rem",
            background: "#7c3aed",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontWeight: 500,
            marginBottom: "1.5rem",
            cursor: "pointer",
          }}
        >
          New Campaign
        </button>
      )}
      <div style={{ background: "#18181b", borderRadius: 8, border: "1px solid #27272a", overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: "2rem", color: "#71717a" }}>Loading...</div>
        ) : list.length === 0 ? (
          <div style={{ padding: "2rem", color: "#71717a" }}>No campaigns. Create one to get started.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#27272a" }}>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>Name</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>Status</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>Progress</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>Daily Limit</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>Leads</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}></th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid #27272a" }}>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <Link to={`/campaigns/${c.id}`}>{c.name}</Link>
                  </td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <span style={{
                      padding: "0.25rem 0.5rem",
                      borderRadius: 4,
                      background: c.status === "active" ? "#166534" : c.status === "paused" ? "#854d0e" : c.status === "finished" ? "#1e40af" : "#374151",
                      fontSize: "0.875rem",
                    }}>
                      {c.status}
                    </span>
                  </td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <span style={{ fontSize: "0.875rem" }}>{c.completionPercent ?? 0}%</span>
                  </td>
                  <td style={{ padding: "0.75rem 1rem" }}>{c.dailyLimit}</td>
                  <td style={{ padding: "0.75rem 1rem" }}>{c._count?.leads ?? 0}</td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <button onClick={(e) => remove(c.id, e)} style={{ padding: "0.25rem 0.5rem", background: "#7f1d1d", color: "white", border: "none", borderRadius: 4, fontSize: "0.875rem" }}>Delete</button>
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
