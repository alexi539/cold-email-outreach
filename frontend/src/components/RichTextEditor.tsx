import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import { GMAIL_MAX_MESSAGE_BYTES, getUtf8ByteLength, formatBytes } from "../lib/emailLimits";

/** Convert plain text to HTML for backward compatibility */
function toHtml(value: string): string {
  if (!value?.trim()) return "<p></p>";
  if (value.trim().startsWith("<") && value.includes(">")) return value;
  return value
    .split(/\n\n+/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

const editorStyles = `
  .rich-editor {
    min-height: 240px;
    padding: 0.75rem 1rem;
    background: #18181b;
    border: 1px solid #3f3f46;
    border-top: none;
    border-radius: 0 0 6px 6px;
    color: #e4e4e7;
    font-size: 0.9375rem;
    line-height: 1.6;
  }
  .rich-editor:focus-within {
    border-color: #7c3aed;
    outline: none;
  }
  .rich-editor p {
    margin: 0 0 0.5em;
  }
  .rich-editor p:last-child {
    margin-bottom: 0;
  }
  .rich-editor strong {
    font-weight: 700;
  }
  .rich-editor em {
    font-style: italic;
  }
  .rich-editor ul, .rich-editor ol {
    padding-left: 1.5em;
    margin: 0.5em 0;
  }
  .rich-editor .ProseMirror {
    outline: none;
    min-height: 220px;
  }
  .rich-editor .ProseMirror p.is-editor-empty:first-child::before {
    content: attr(data-placeholder);
    color: #71717a;
    float: left;
    height: 0;
    pointer-events: none;
  }
  .rich-toolbar {
    display: flex;
    gap: 2px;
    padding: 0.25rem;
    background: #27272a;
    border: 1px solid #3f3f46;
    border-bottom: none;
    border-radius: 6px 6px 0 0;
  }
  .rich-toolbar button {
    padding: 0.35rem 0.6rem;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: #a1a1aa;
    font-size: 0.875rem;
    cursor: pointer;
  }
  .rich-toolbar button:hover {
    background: #3f3f46;
    color: #e4e4e7;
  }
  .rich-toolbar button.is-active {
    background: #7c3aed;
    color: white;
  }
  .rich-editor-wrapper {
    border-radius: 6px;
  }
`;

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;
  return (
    <div className="rich-toolbar">
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={editor.isActive("bold") ? "is-active" : ""}
        title="Bold (Ctrl+B / Cmd+B)"
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={editor.isActive("italic") ? "is-active" : ""}
        title="Italic (Ctrl+I / Cmd+I)"
      >
        <em>I</em>
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={editor.isActive("strike") ? "is-active" : ""}
        title="Strikethrough"
      >
        <s>S</s>
      </button>
      <span style={{ width: 1, background: "#3f3f46", margin: "0 4px" }} />
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={editor.isActive("bulletList") ? "is-active" : ""}
        title="Bullet list"
      >
        • List
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={editor.isActive("orderedList") ? "is-active" : ""}
        title="Numbered list"
      >
        1. List
      </button>
    </div>
  );
}

export interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Max body size in bytes (default: Gmail 25 MB limit) */
  maxBytes?: number;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "Write your email...",
  maxBytes = GMAIL_MAX_MESSAGE_BYTES,
}: RichTextEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastValidContentRef = useRef<string>(toHtml(value));
  const [bodyBytes, setBodyBytes] = useState(0);

  const editor = useEditor({
    extensions: [StarterKit],
    content: toHtml(value),
    editorProps: {
      attributes: {
        "data-placeholder": placeholder,
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      const bytes = getUtf8ByteLength(html);
      setBodyBytes(bytes);
      if (bytes > maxBytes) {
        editor.commands.setContent(lastValidContentRef.current, { emitUpdate: false });
        setBodyBytes(getUtf8ByteLength(lastValidContentRef.current));
        return;
      }
      lastValidContentRef.current = html;
      onChangeRef.current(html);
    },
  });

  useEffect(() => {
    if (!editor) return;
    const currentHtml = editor.getHTML();
    const targetHtml = toHtml(value);
    if (currentHtml !== targetHtml) {
      editor.commands.setContent(targetHtml, { emitUpdate: false });
      lastValidContentRef.current = targetHtml;
      setBodyBytes(getUtf8ByteLength(targetHtml));
    }
  }, [value, editor]);

  const showCounter = bodyBytes > 100 * 1024; // show when > 100 KB
  const isOverLimit = bodyBytes > maxBytes;

  return (
    <>
      <style>{editorStyles}</style>
      <div className="rich-editor-wrapper">
        <Toolbar editor={editor} />
        <div className="rich-editor">
          <EditorContent editor={editor} />
        </div>
        {showCounter && (
          <div
            style={{
              marginTop: "0.25rem",
              fontSize: "0.75rem",
              color: isOverLimit ? "#ef4444" : bodyBytes > maxBytes * 0.9 ? "#f59e0b" : "#71717a",
            }}
          >
            {formatBytes(bodyBytes)} / {formatBytes(maxBytes)}
            {isOverLimit && " — limit reached"}
          </div>
        )}
      </div>
    </>
  );
}
