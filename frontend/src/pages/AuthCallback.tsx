import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { auth } from "../api";

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const code = searchParams.get("code");
    const accountId = searchParams.get("accountId") || undefined;
    if (!code) {
      setStatus("error");
      setMessage("No authorization code received");
      return;
    }
    auth
      .googleCallback(code, accountId, window.location.origin + "/auth/callback")
      .then((res) => {
        setStatus("success");
        setMessage(`Connected ${res.email}`);
        if (window.opener) {
          window.opener.postMessage({ type: "google-oauth-done" }, "*");
          setTimeout(() => window.close(), 1500);
        }
      })
      .catch((err) => {
        setStatus("error");
        setMessage((err as Error).message);
      });
  }, [searchParams]);

  return (
    <div style={{ padding: "2rem", textAlign: "center", fontFamily: "sans-serif" }}>
      {status === "loading" && <p>Connecting...</p>}
      {status === "success" && <p style={{ color: "#166534" }}>{message}</p>}
      {status === "error" && <p style={{ color: "#dc2626" }}>{message}</p>}
    </div>
  );
}
