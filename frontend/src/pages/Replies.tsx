import { useEffect, useState, Fragment } from "react";
import { Link } from "react-router-dom";
import { history, campaigns } from "../api";
import type { SentEmail, Campaign } from "../api";

type ReplyTypeFilter = "" | "replied" | "bounce" | "auto_reply";

export default function Replies() {
  const [list, setList] = useState<SentEmail[]>([]);
  const [campaignsList, setCampaignsList] = useState<Campaign[]>([]);
  const [filterCampaign, setFilterCampaign] = useState<string>("");
  const [filterType, setFilterType] = useState<ReplyTypeFilter>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const statusParam =
    filterType === ""
      ? "replied,bounce,auto_reply"
      : filterType;

  useEffect(() => {
    const params: { status: string; campaignId?: string } = { status: statusParam };
    if (filterCampaign) params.campaignId = filterCampaign;
    history.list(params).then(setList).finally(() => setLoading(false));
    campaigns.list().then(setCampaignsList).catch(console.error);
  }, [filterCampaign, statusParam]);

  const refresh = () => {
    setLoading(true);
    const params: { status: string; campaignId?: string } = { status: statusParam };
    if (filterCampaign) params.campaignId = filterCampaign;
    history.list(params).then(setList).finally(() => setLoading(false));
  };

  const getTypeBadgeStyle = (status: string) => {
    if (status === "replied") return { background: "#166534", color: "#fff" };
    if (status === "bounce") return { background: "#991b1b", color: "#fff" };
    if (status === "auto_reply") return { background: "#854d0e", color: "#fff" };
    return { background: "#374151", color: "#fff" };
  };

  return (
    <div>
      <h1 style={{ margin: "0 0 1.5rem", fontSize: "1.75rem" }}>Replies</h1>
      <p style={{ margin: "0 0 1rem", color: "#a1a1aa", fontSize: "0.875rem" }}>
        All replies received to your cold emails. Human replies, bounces, and auto-replies are detected automatically.
      </p>
      <div style={{ marginBottom: "1rem", display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
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
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label style={{ fontSize: "0.875rem" }}>Type:</label>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as ReplyTypeFilter)}
            style={{ padding: "0.5rem", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }}
          >
            <option value="">All</option>
            <option value="replied">Human</option>
            <option value="bounce">Bounce</option>
            <option value="auto_reply">Auto-reply</option>
          </select>
        </div>
        <button
          onClick={refresh}
          style={{ padding: "0.5rem 1rem", background: "#27272a", color: "white", border: "1px solid #3f3f46", borderRadius: 6 }}
        >
          Refresh
        </button>
      </div>
      <div style={{ background: "#18181b", borderRadius: 8, border: "1px solid #27272a", overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: "2rem", color: "#71717a" }}>Loading...</div>
        ) : list.length === 0 ? (
          <div style={{ padding: "2rem", color: "#71717a" }}>
            No replies yet. Replies are detected every 3 minutes.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#27272a" }}>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>Date</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>To</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>Subject</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>Campaign</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>Account</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>Type</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600 }}>Reply</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <Fragment key={s.id}>
                  <tr style={{ borderTop: "1px solid #27272a" }}>
                    <td style={{ padding: "0.75rem 1rem", fontSize: "0.875rem" }}>
                      {s.replyAt ? new Date(s.replyAt).toLocaleString() : new Date(s.sentAt).toLocaleString()}
                    </td>
                    <td style={{ padding: "0.75rem 1rem" }}>{s.lead?.email ?? "—"}</td>
                    <td style={{ padding: "0.75rem 1rem", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{s.subject}</td>
                    <td style={{ padding: "0.75rem 1rem", fontSize: "0.875rem" }}>
                      {s.campaign ? (
                        <Link to={`/campaigns/${s.campaign.id}`} style={{ color: "#a78bfa", textDecoration: "none" }}>
                          {s.campaign.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ padding: "0.75rem 1rem", fontSize: "0.875rem" }}>{s.account?.email ?? "—"}</td>
                    <td style={{ padding: "0.75rem 1rem" }}>
                      <span
                        style={{
                          padding: "0.25rem 0.5rem",
                          borderRadius: 4,
                          fontSize: "0.875rem",
                          ...getTypeBadgeStyle(s.status),
                        }}
                      >
                        {s.replyType || s.status}
                      </span>
                    </td>
                    <td style={{ padding: "0.75rem 1rem" }}>
                      {s.replyBody ? (
                        <button
                          onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                          style={{
                            padding: "0.25rem 0.5rem",
                            background: "#3f3f46",
                            border: "none",
                            borderRadius: 4,
                            color: "#a78bfa",
                            cursor: "pointer",
                            fontSize: "0.875rem",
                          }}
                        >
                          {expandedId === s.id ? "Hide" : "Show"}
                        </button>
                      ) : (
                        <span style={{ color: "#71717a", fontSize: "0.875rem" }}>—</span>
                      )}
                    </td>
                  </tr>
                  {expandedId === s.id && s.replyBody && (
                    <tr style={{ borderTop: "none", background: "#0f0f10" }}>
                      <td colSpan={7} style={{ padding: "1rem 1rem 1.5rem", borderTop: "1px solid #27272a" }}>
                        <div
                          style={{
                            whiteSpace: "pre-wrap",
                            fontFamily: "monospace",
                            fontSize: "0.8125rem",
                            color: "#d4d4d8",
                            maxHeight: 300,
                            overflow: "auto",
                            padding: "1rem",
                            background: "#18181b",
                            borderRadius: 6,
                            border: "1px solid #27272a",
                          }}
                        >
                          {s.replyBody}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
