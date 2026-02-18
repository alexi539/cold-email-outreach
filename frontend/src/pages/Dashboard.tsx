import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { stats, campaigns } from "../api";

export default function Dashboard() {
  const [statsData, setStatsData] = useState<{ campaigns: number; accounts: number; totalSent: number; totalReplied: number } | null>(null);
  const [campaignList, setCampaignList] = useState<Awaited<ReturnType<typeof campaigns.list>> | null>(null);

  useEffect(() => {
    stats.dashboard().then(setStatsData).catch(console.error);
    campaigns.list().then(setCampaignList).catch(console.error);
  }, []);

  return (
    <div>
      <h1 style={{ margin: "0 0 1.5rem", fontSize: "1.75rem" }}>Dashboard</h1>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem", marginBottom: "2rem" }}>
        <Card title="Campaigns" value={statsData?.campaigns ?? "—"} />
        <Card title="Email Accounts" value={statsData?.accounts ?? "—"} />
        <Card title="Total Sent" value={statsData?.totalSent ?? "—"} />
        <Card title="Replies" value={statsData?.totalReplied ?? "—"} />
      </div>
      <section>
        <h2 style={{ margin: "0 0 1rem", fontSize: "1.25rem" }}>Campaigns</h2>
        <div style={{ background: "#18181b", borderRadius: 8, border: "1px solid #27272a", overflow: "hidden" }}>
          {campaignList?.length ? (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#27272a" }}>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>Name</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>Status</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>Leads</th>
                </tr>
              </thead>
              <tbody>
                {campaignList.map((c) => (
                  <tr key={c.id} style={{ borderTop: "1px solid #27272a" }}>
                    <td style={{ padding: "0.75rem 1rem" }}>
                      <Link to={`/campaigns/${c.id}`}>{c.name}</Link>
                    </td>
                    <td style={{ padding: "0.75rem 1rem" }}>
                      <span style={{
                        padding: "0.25rem 0.5rem",
                        borderRadius: 4,
                        background: c.status === "active" ? "#166534" : c.status === "paused" ? "#854d0e" : "#374151",
                        fontSize: "0.875rem",
                      }}>
                        {c.status}
                      </span>
                    </td>
                    <td style={{ padding: "0.75rem 1rem" }}>{c._count?.leads ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: "2rem", color: "#71717a" }}>No campaigns yet. Create one to get started.</div>
          )}
        </div>
      </section>
    </div>
  );
}

function Card({ title, value }: { title: string; value: string | number }) {
  return (
    <div style={{ background: "#18181b", padding: "1.25rem", borderRadius: 8, border: "1px solid #27272a" }}>
      <div style={{ fontSize: "0.875rem", color: "#71717a", marginBottom: "0.25rem" }}>{title}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>{value}</div>
    </div>
  );
}
