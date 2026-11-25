import { useRef, useState } from "react";
import { removeDocument, uploadDocuments } from "../api";
import type { PageProps } from "../pageProps";
import { Card, CardHead, EmptyState, Field, StatusPill } from "../components/ui";
import { formatDate } from "../utils";

const MAX_BYTES = 20 * 1024 * 1024;
const DOC_TYPES = ["receipt", "invoice", "statement", "spreadsheet", "image", "contract", "other"];

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extension(name: string) {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()!.slice(0, 4) : "file";
}

export default function Documents({ state, refresh, notify }: PageProps) {
  const settings = state.settings;
  const documents = state.documents || [];
  const [docType, setDocType] = useState("receipt");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || !fileList.length) return;
    const files = [...fileList];
    const oversized = files.filter((file) => file.size > MAX_BYTES);
    if (oversized.length) {
      notify(`${oversized.map((file) => file.name).join(", ")} — each file must be 20 MB or smaller.`, true);
    }
    const accepted = files.filter((file) => file.size <= MAX_BYTES && file.size > 0);
    if (!accepted.length) return;
    setBusy(true);
    try {
      const result = await uploadDocuments(accepted, docType);
      await refresh();
      const rejectedNote = result.rejected?.length
        ? ` ${result.rejected.length} file(s) rejected: ${result.rejected.map((item) => `${item.name} (${item.reason})`).join("; ")}`
        : "";
      notify(`${result.stored.length} file(s) stored.${rejectedNote}`, !!result.rejected?.length);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Upload failed.", true);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete the stored file ${name}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await removeDocument(id);
      await refresh();
      notify("Document deleted.");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not delete the document.", true);
    } finally {
      setBusy(false);
    }
  };

  const totalBytes = documents.reduce((sum, doc) => sum + doc.size, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Records</p>
          <h1 className="page-title">Documents</h1>
          <p className="page-sub">
            Receipts, invoices, statements and spreadsheets — {documents.length} stored, {fileSize(totalBytes)} in total. Limit
            20 MB per file.
          </p>
        </div>
        <div className="row">
          <Field label="Document type">
            <select className="select" value={docType} onChange={(event) => setDocType(event.target.value)}>
              {DOC_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>
          <button className="btn" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? "Uploading…" : "Upload files"}
          </button>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="sr-only"
        accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.svg,.txt,.csv,.tsv,.xls,.xlsx,.doc,.docx,.ppt,.pptx,.json,.xml,.eml,.msg"
        onChange={(event) => void handleFiles(event.target.files)}
      />

      <div
        className={`dropzone ${dragging ? "active" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void handleFiles(event.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
        }}
      >
        <strong style={{ color: "var(--ink)", display: "block", marginBottom: 4 }}>
          Drop paperwork here, or click to choose files
        </strong>
        PDF, images, CSV/XLSX, statements and invoices · up to 20 MB each. Originals are stored privately and only served
        through Spendos.
      </div>

      <div className="grid-2" style={{ marginTop: 18 }}>
        <Card>
          <CardHead title="Stored documents" note="Newest first" />
          {documents.length ? (
            documents.map((doc) => (
              <div className="doc-row" key={doc.id}>
                <div className="doc-badge">{extension(doc.name)}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="tx-merchant" title={doc.name}>
                    {doc.name}
                  </div>
                  <div className="tx-meta">
                    <span>{formatDate(doc.uploadedAt.slice(0, 10))}</span>
                    <span>·</span>
                    <span>{fileSize(doc.size)}</span>
                    <span>·</span>
                    <span>{doc.docType}</span>
                    {doc.driveFileId ? (
                      <>
                        <span>·</span>
                        <span>Drive import</span>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <StatusPill status={doc.status} />
                  <a className="btn secondary small" href={doc.fileUrl} target="_blank" rel="noreferrer">
                    Open
                  </a>
                  <button className="link-btn" onClick={() => void remove(doc.id, doc.name)} disabled={busy}>
                    Delete
                  </button>
                </div>
              </div>
            ))
          ) : (
            <EmptyState title="No documents yet">
              Upload the first receipt or invoice so it is attached to your household record.
            </EmptyState>
          )}
        </Card>

        <div className="stack">
          <Card>
            <CardHead title="How documents are handled" />
            <ul className="insight-list">
              <li>
                <span className="bullet" />
                <span>
                  <strong>Originals only.</strong> The exact bytes you upload are kept — nothing is re-encoded or shrunk.
                </span>
              </li>
              <li>
                <span className="bullet" />
                <span>
                  <strong>Private storage.</strong> Files live in the Site's private object store; there is no public bucket
                  link. Downloads go through Spendos.
                </span>
              </li>
              <li>
                <span className="bullet" />
                <span>
                  <strong>Nothing invented.</strong> A document never creates a transaction by itself. Entries are only added
                  from values you confirm.
                </span>
              </li>
              <li>
                <span className="bullet" />
                <span>
                  <strong>Statuses.</strong> queued while it is being stored, stored once saved, review when extraction is
                  uncertain.
                </span>
              </li>
            </ul>
          </Card>
          <Card>
            <CardHead title="Storage summary" />
            <div className="insight-list">
              <div>
                <div className="budget-top">
                  <span>Files</span>
                  <span className="num">{documents.length}</span>
                </div>
              </div>
              <div>
                <div className="budget-top">
                  <span>Total size</span>
                  <span className="num">{fileSize(totalBytes)}</span>
                </div>
              </div>
              <div>
                <div className="budget-top">
                  <span>Awaiting review</span>
                  <span className="num">{documents.filter((doc) => doc.status === "review").length}</span>
                </div>
              </div>
              <div>
                <div className="budget-top">
                  <span>Currency of record</span>
                  <span className="num">{settings.currency}</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
