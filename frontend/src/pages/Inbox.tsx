import { useState } from "react";
import { inbox } from "../api";
import type {
  Account,
  InboxMessageListItem,
  InboxThreadResponse,
  InboxThreadMessage,
} from "../api";
import { useInbox, UNIFIED_VALUE } from "../contexts/InboxContext";
import { RichTextEditor } from "../components/RichTextEditor";

function extractEmailFromHeader(s: string): string {
  const m = /<([^>]+)>/.exec(s);
  if (m) return m[1].trim().toLowerCase();
  return s.trim().toLowerCase();
}

function replySubject(subject: string): string {
  const s = subject.trim();
  if (s.toLowerCase().startsWith("re:")) return s;
  return `Re: ${s}`;
}

export default function Inbox() {
  const {
    accountId: selectedAccountId,
    setAccountId,
    messages,
    nextPageToken,
    loading,
    error: inboxError,
    clearError,
    loadMore,
    refresh: contextRefresh,
    activeAccounts,
  } = useInbox();

  const [selectedListItem, setSelectedListItem] = useState<InboxMessageListItem | null>(null);
  const [selectedThread, setSelectedThread] = useState<InboxThreadResponse | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyFromAccountId, setReplyFromAccountId] = useState<string>("");
  const [sending, setSending] = useState(false);

  const isUnified = selectedAccountId === UNIFIED_VALUE;

  const handleAccountChange = (newId: string) => {
    setAccountId(newId);
    setSelectedListItem(null);
    setSelectedThread(null);
    setThreadError(null);
    clearError();
  };

  const refresh = async () => {
    setThreadError(null);
    await contextRefresh();
    if (selectedListItem) {
      setLoadingThread(true);
      inbox
        .getThread(selectedListItem.accountId, selectedListItem.id)
        .then((thread) => {
          setSelectedThread(thread);
          setReplyFromAccountId(thread.accountId);
        })
        .catch((e) => {
          const msg = e instanceof Error ? e.message : "Failed to load thread";
          setThreadError(msg);
        })
        .finally(() => setLoadingThread(false));
    }
  };

  const selectMessage = (msg: InboxMessageListItem) => {
    setThreadError(null);
    setLoadingThread(true);
    setSelectedListItem(msg);
    setSelectedThread(null);
    setReplyBody("");
    inbox
      .getThread(msg.accountId, msg.id)
      .then((thread) => {
        setSelectedThread(thread);
        setReplyFromAccountId(thread.accountId);
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "Failed to load thread";
        setThreadError(msg);
      })
      .finally(() => setLoadingThread(false));
  };

  const lastFromThem = selectedThread
    ? [...selectedThread.messages].reverse().find((m) => !m.isFromUs)
    : null;

  const handleSendReply = async () => {
    if (!selectedThread || !lastFromThem || sending) return;
    const to = extractEmailFromHeader(lastFromThem.from);
    const subject = replySubject(lastFromThem.subject);
    const accountId = replyFromAccountId || selectedThread.accountId;
    if (!to) {
      alert("Could not extract recipient email");
      return;
    }
    setSending(true);
    try {
      await inbox.sendReply({
        accountId,
        messageId: lastFromThem.id,
        to,
        subject,
        body: replyBody,
        rfcMessageId: lastFromThem.messageId,
        references: lastFromThem.references,
        threadId: selectedThread.threadId,
      });
      setReplyBody("");
      await refresh();
      window.dispatchEvent(new Event("inbox-update"));
    } catch (e) {
      const msg =
        e instanceof Error && e.name === "AbortError"
          ? "Request timed out. Please try again."
          : e instanceof Error
            ? e.message
            : "Failed to send";
      alert(msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <h1 style={{ margin: "0 0 1.5rem", fontSize: "1.75rem" }}>Inbox</h1>
      <p style={{ margin: "0 0 1rem", color: "#a1a1aa", fontSize: "0.875rem" }}>
        All incoming messages from your email accounts. Select a message to read and reply.
      </p>
      {inboxError && (
        <div
          style={{
            marginBottom: "1rem",
            padding: "0.75rem 1rem",
            background: "#450a0a",
            border: "1px solid #b91c1c",
            borderRadius: 6,
            color: "#fca5a5",
            fontSize: "0.875rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{inboxError}</span>
          <button
            onClick={() => clearError()}
            style={{
              background: "transparent",
              border: "none",
              color: "#fca5a5",
              cursor: "pointer",
              fontSize: "1.25rem",
              padding: "0 0.25rem",
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      <div style={{ marginBottom: "1rem", display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label style={{ fontSize: "0.875rem" }}>Account:</label>
          <select
            value={selectedAccountId}
            onChange={(e) => handleAccountChange(e.target.value)}
            style={{
              padding: "0.5rem",
              background: "#27272a",
              border: "1px solid #3f3f46",
              borderRadius: 6,
              color: "#e4e4e7",
              minWidth: 200,
            }}
          >
            <option value="">Select account</option>
            <option value={UNIFIED_VALUE}>All accounts</option>
            {activeAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={refresh}
          disabled={!selectedAccountId || loading}
          style={{
            padding: "0.5rem 1rem",
            background: "#27272a",
            color: "white",
            border: "1px solid #3f3f46",
            borderRadius: 6,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          Refresh
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 1fr) minmax(400px, 2fr)",
          gap: "1rem",
          minHeight: 500,
          background: "#18181b",
          borderRadius: 8,
          border: "1px solid #27272a",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            borderRight: "1px solid #27272a",
            overflowY: "auto",
            maxHeight: 600,
          }}
        >
          {!selectedAccountId ? (
            <div style={{ padding: "2rem", color: "#71717a" }}>Select an account to view inbox.</div>
          ) : loading && messages.length === 0 ? (
            <div style={{ padding: "2rem", color: "#71717a" }}>Loading...</div>
          ) : messages.length === 0 ? (
            <div style={{ padding: "2rem", color: "#71717a" }}>No messages in inbox.</div>
          ) : (
            <>
              {messages.map((msg) => (
                <div
                  key={`${msg.accountId}:${msg.id}`}
                  onClick={() => selectMessage(msg)}
                  style={{
                    padding: "0.75rem 1rem",
                    borderBottom: "1px solid #27272a",
                    cursor: "pointer",
                    background:
                      selectedListItem?.id === msg.id && selectedListItem?.accountId === msg.accountId
                        ? "#27272a"
                        : "transparent",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                    <span style={{ fontWeight: msg.unread ? 600 : 400, fontSize: "0.875rem" }}>
                      {msg.from.length > 40 ? msg.from.slice(0, 37) + "..." : msg.from}
                    </span>
                    <span style={{ fontSize: "0.75rem", color: "#71717a", flexShrink: 0 }}>
                      {new Date(msg.date).toLocaleDateString()}
                    </span>
                  </div>
                  {isUnified && (
                    <div style={{ fontSize: "0.7rem", color: "#71717a", marginTop: "0.15rem" }}>
                      {msg.accountEmail}
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: "0.8125rem",
                      color: "#a1a1aa",
                      marginTop: "0.25rem",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {msg.subject || "(no subject)"}
                  </div>
                  {msg.snippet && (
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "#71717a",
                        marginTop: "0.25rem",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {msg.snippet}
                    </div>
                  )}
                </div>
              ))}
              {nextPageToken && (
                <div style={{ padding: "0.75rem 1rem", textAlign: "center" }}>
                  <button
                    onClick={loadMore}
                    disabled={loading}
                    style={{
                      padding: "0.4rem 0.8rem",
                      background: "#27272a",
                      color: "#a78bfa",
                      border: "1px solid #3f3f46",
                      borderRadius: 6,
                      cursor: loading ? "not-allowed" : "pointer",
                      fontSize: "0.875rem",
                    }}
                  >
                    {loading ? "Loading..." : "Load more"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ padding: "1rem", overflowY: "auto" }}>
          {!selectedThread ? (
            <div style={{ color: "#71717a", padding: "2rem" }}>
              {threadError ? (
                <div style={{ color: "#ef4444" }}>{threadError}</div>
              ) : selectedAccountId && messages.length > 0 ? (
                "Select a message to read and reply."
              ) : (
                ""
              )}
            </div>
          ) : loadingThread ? (
            <div style={{ color: "#71717a" }}>Loading thread...</div>
          ) : (
            <ThreadView
              thread={selectedThread}
              replyBody={replyBody}
              setReplyBody={setReplyBody}
              replyFromAccountId={replyFromAccountId}
              setReplyFromAccountId={setReplyFromAccountId}
              activeAccounts={activeAccounts}
              lastFromThem={lastFromThem}
              handleSendReply={handleSendReply}
              sending={sending}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ThreadView({
  thread,
  replyBody,
  setReplyBody,
  replyFromAccountId,
  setReplyFromAccountId,
  activeAccounts,
  lastFromThem,
  handleSendReply,
  sending,
}: {
  thread: InboxThreadResponse;
  replyBody: string;
  setReplyBody: (s: string) => void;
  replyFromAccountId: string;
  setReplyFromAccountId: (s: string) => void;
  activeAccounts: Account[];
  lastFromThem: InboxThreadMessage | null | undefined;
  handleSendReply: () => void;
  sending: boolean;
}) {
  return (
    <>
      <div style={{ marginBottom: "1rem", fontSize: "0.875rem", color: "#a1a1aa" }}>
        {thread.accountEmail} — {thread.messages.length} message{thread.messages.length !== 1 ? "s" : ""} in thread
      </div>

      <div style={{ marginBottom: "1.5rem" }}>
        {thread.messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              marginBottom: "1rem",
              padding: "1rem",
              background: msg.isFromUs ? "#1e1b4b" : "#27272a",
              borderRadius: 6,
              borderLeft: `3px solid ${msg.isFromUs ? "#7c3aed" : "#3f3f46"}`,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>
                {msg.isFromUs ? "You" : msg.from}
              </span>
              <span style={{ fontSize: "0.75rem", color: "#71717a" }}>
                {new Date(msg.date).toLocaleString()}
              </span>
            </div>
            <div
              style={{
                whiteSpace: "pre-wrap",
                fontSize: "0.8125rem",
                color: "#d4d4d8",
                lineHeight: 1.5,
              }}
            >
              {msg.body || "(no body)"}
            </div>
          </div>
        ))}
      </div>

      {lastFromThem && (
        <div style={{ borderTop: "1px solid #27272a", paddingTop: "1rem" }}>
          <h3 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>Reply</h3>
          {activeAccounts.length > 1 && (
            <div style={{ marginBottom: "0.75rem", fontSize: "0.875rem" }}>
              <strong>Reply from:</strong>{" "}
              <select
                value={replyFromAccountId}
                onChange={(e) => setReplyFromAccountId(e.target.value)}
                style={{
                  padding: "0.35rem 0.5rem",
                  background: "#27272a",
                  border: "1px solid #3f3f46",
                  borderRadius: 4,
                  color: "#e4e4e7",
                  marginLeft: "0.5rem",
                }}
              >
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.email}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div style={{ marginBottom: "0.75rem", fontSize: "0.875rem" }}>
            <strong>To:</strong> {extractEmailFromHeader(lastFromThem.from) || lastFromThem.from}
          </div>
          <div style={{ marginBottom: "0.75rem", fontSize: "0.875rem" }}>
            <strong>Subject:</strong> {replySubject(lastFromThem.subject)}
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <RichTextEditor
              value={replyBody}
              onChange={setReplyBody}
              placeholder="Type your reply..."
            />
          </div>
          <button
            onClick={handleSendReply}
            disabled={sending}
            style={{
              padding: "0.5rem 1.25rem",
              background: "#7c3aed",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: sending ? "not-allowed" : "pointer",
              fontWeight: 600,
            }}
          >
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      )}
    </>
  );
}
