import { useEffect, useState } from "react";
import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { InboxProvider } from "./contexts/InboxContext";
import Dashboard from "./pages/Dashboard";
import Accounts from "./pages/Accounts";
import Campaigns from "./pages/Campaigns";
import CampaignEdit from "./pages/CampaignEdit";
import History from "./pages/History";
import Inbox from "./pages/Inbox";
import AuthCallback from "./pages/AuthCallback";
import { inbox } from "./api";

function App() {
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchUnread = (fresh = false) => {
    inbox.unreadCount(undefined, { fresh }).then((r) => setUnreadCount(r.total)).catch(() => setUnreadCount(0));
  };

  useEffect(() => {
    fetchUnread(true);
    const interval = setInterval(() => fetchUnread(false), 60000);
    const onFocus = () => fetchUnread(true);
    const onInboxUpdate = () => fetchUnread(true);
    window.addEventListener("focus", onFocus);
    window.addEventListener("inbox-update", onInboxUpdate);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("inbox-update", onInboxUpdate);
    };
  }, []);

  return (
    <InboxProvider>
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav style={{
        width: 220,
        background: "#18181b",
        padding: "1.5rem 0",
        borderRight: "1px solid #27272a",
      }}>
        <div style={{ padding: "0 1rem", marginBottom: "1.5rem" }}>
          <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>Cold Email</h1>
        </div>
        <NavLink
          to="/"
          style={({ isActive }) => ({
            display: "block",
            padding: "0.5rem 1rem",
            color: isActive ? "#a78bfa" : "#a1a1aa",
            fontWeight: isActive ? 600 : 400,
          })}
        >
          Dashboard
        </NavLink>
        <NavLink
          to="/accounts"
          style={({ isActive }) => ({
            display: "block",
            padding: "0.5rem 1rem",
            color: isActive ? "#a78bfa" : "#a1a1aa",
            fontWeight: isActive ? 600 : 400,
          })}
        >
          Email Accounts
        </NavLink>
        <NavLink
          to="/campaigns"
          style={({ isActive }) => ({
            display: "block",
            padding: "0.5rem 1rem",
            color: isActive ? "#a78bfa" : "#a1a1aa",
            fontWeight: isActive ? 600 : 400,
          })}
        >
          Campaigns
        </NavLink>
        <NavLink
          to="/inbox"
          style={({ isActive }) => ({
            display: "flex",
            alignItems: "center",
            padding: "0.5rem 1rem",
            color: isActive ? "#a78bfa" : "#a1a1aa",
            fontWeight: isActive ? 600 : 400,
          })}
        >
          Inbox
          {unreadCount > 0 && (
            <span
              style={{
                marginLeft: 6,
                background: "#a78bfa",
                color: "#fff",
                borderRadius: 10,
                padding: "2px 6px",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </NavLink>
        <NavLink
          to="/history"
          style={({ isActive }) => ({
            display: "block",
            padding: "0.5rem 1rem",
            color: isActive ? "#a78bfa" : "#a1a1aa",
            fontWeight: isActive ? 600 : 400,
          })}
        >
          History
        </NavLink>
      </nav>
      <main style={{ flex: 1, padding: "2rem", overflow: "auto" }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/:id" element={<CampaignEdit />} />
          <Route path="/campaigns/new" element={<Navigate to="/campaigns" replace state={{ create: true }} />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/replies" element={<Navigate to="/inbox" replace />} />
          <Route path="/history" element={<History />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
        </Routes>
      </main>
    </div>
    </InboxProvider>
  );
}

export default App;
