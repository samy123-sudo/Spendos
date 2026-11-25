import { useState } from "react";
import type { FormEvent } from "react";
import { signIn } from "../api";

interface Props {
  onUnlocked: () => void;
}

export default function LockScreen({ onUnlocked }: Props) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!passphrase || busy) return;
    setBusy(true);
    setError("");
    try {
      await signIn(passphrase);
      setPassphrase("");
      onUnlocked();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: 24 }}>
      <form className="card card-pad" style={{ width: "100%", maxWidth: 400 }} onSubmit={submit}>
        <div className="brand-mark" style={{ marginBottom: 14 }}>
          S
        </div>
        <h1 className="page-title" style={{ fontSize: "1.35rem", marginBottom: 6 }}>
          Spendos is locked
        </h1>
        <p className="page-sub" style={{ marginBottom: 18 }}>
          Enter the household passphrase to open the ledger.
        </p>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "var(--ink-soft)" }}>
            Passphrase
          </div>
          <input
            className="input"
            type="password"
            name="passphrase"
            autoComplete="current-password"
            autoFocus
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="Household passphrase"
          />
        </div>
        <button className="btn accent" type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
        {error ? (
          <p style={{ marginTop: 12, fontSize: "0.85rem", color: "var(--danger-edge)" }}>{error}</p>
        ) : null}
      </form>
    </div>
  );
}
