import { useEffect, useState } from "react";
import { history, campaigns } from "../api";
import type { SentEmail, Campaign } from "../api";

export default function History() {
  const [list, setList] = useState<SentEmail[]>([]);
  const [campaignsList, setCampaignsList] = useState<Campaign[]>([]);
  const [filterCampaign, setFilterCampaign] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    history.list(filterCampaign ? { campaignId: filterCampaign } : undefined).then(setList).finally(() => setLoading(false));
    campaigns.list().then(setCampaignsList).catch(console.error);
  }, [filterCampaign]);

  const refresh = () => {
    setLoading(true);
    history.list(filterCampaign ? { campaignId: filterCampaign } : undefined).then(setList).finally(() => setLoading(false));
  };

  return (
    <div>
      <h1 style={{ margin: "0 0 1.5rem", fontSize: "1.75rem" }}>History</h1>
      <div style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <label style={{ fontSize: "0.875rem" }}>Campaign:</label>
        <select
          value={filterCampaign}
          onChange={(e) => setFilterCampaign(e.target.value)}
          style={{ padding: "0.5rem", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }}
        >
          <option value="">All</option>
          {campaignsList.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button onClick={refresh} style={{ padding: "0.5rem 1rem", background: "#27272a", color: "white", border: "1px solid #3f3f46", borderRadius: 6 }}>Refresh</button>
      </div>
      <div style={{ background: "#18181b", borderRadius: 8, border: "1px solid #27272a", overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: "2rem", color: "#71717a" }}>Loading...</div>
        ) : list.length === 0 ? (
          <div style={{ padding: "2rem", color: "#71717a" }}>No sent emails yet.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#27272a" }}>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>Date</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>To</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>Subject</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>Account</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} style={{ borderTop: "1px solid #27272a" }}>
                  <td style={{ padding: "0.75rem 1rem", fontSize: "0.875rem" }}>
                    {new Date(s.sentAt).toLocaleString()}
                  </td>
                  <td style={{ padding: "0.75rem 1rem" }}>{s.lead?.email ?? "—"}</td>
                  <td style={{ padding: "0.75rem 1rem", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }}>{s.subject}</td>
                  <td style={{ padding: "0.75rem 1rem", fontSize: "0.875rem" }}>{s.account?.email ?? "—"}</td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <span style={{
                      padding: "0.25rem 0.5rem",
                      borderRadius: 4,
                      background:
                        s.status === "replied" ? "#166534" :
                        s.status === "bounce" ? "#991b1b" :
                        s.status === "auto_reply" ? "#854d0e" : "#374151",
                      fontSize: "0.875rem",
                    }}>
                      {s.status}
                    </span>
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
