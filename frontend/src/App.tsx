import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Accounts from "./pages/Accounts";
import Campaigns from "./pages/Campaigns";
import CampaignEdit from "./pages/CampaignEdit";
import History from "./pages/History";
import Replies from "./pages/Replies";
import AuthCallback from "./pages/AuthCallback";

function App() {
  return (
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
          to="/replies"
          style={({ isActive }) => ({
            display: "block",
            padding: "0.5rem 1rem",
            color: isActive ? "#a78bfa" : "#a1a1aa",
            fontWeight: isActive ? 600 : 400,
          })}
        >
          Replies
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
          <Route path="/replies" element={<Replies />} />
          <Route path="/history" element={<History />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
