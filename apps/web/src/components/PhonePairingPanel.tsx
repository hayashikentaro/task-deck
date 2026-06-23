import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "./ui/Button";

type PairingState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; pairingUrl: string; expiresAt: string }
  | { status: "error"; error: string };

type PhonePairingPanelProps = {
  decisionGatewayConfigured: boolean;
};

export function PhonePairingPanel({ decisionGatewayConfigured }: PhonePairingPanelProps) {
  const [pairingState, setPairingState] = useState<PairingState>({ status: "idle" });
  const [didCopy, setDidCopy] = useState(false);
  const pairingUrl = pairingState.status === "ready" ? pairingState.pairingUrl : "";
  const expiryLabel = useMemo(
    () => (pairingState.status === "ready" ? formatExpiry(pairingState.expiresAt) : ""),
    [pairingState],
  );
  const isExpired = pairingState.status === "ready" ? pairingExpired(pairingState.expiresAt) : false;
  const canGenerate = decisionGatewayConfigured && pairingState.status !== "loading";

  const generatePairingRequest = async () => {
    if (!canGenerate) {
      return;
    }

    setDidCopy(false);
    setPairingState({ status: "loading" });
    try {
      const response = await fetch("/api/decision-gateway/pairing-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = (await response.json().catch(() => ({}))) as {
        pairingUrl?: string;
        expiresAt?: string;
        error?: string;
      };
      const nextPairingUrl = String(payload.pairingUrl || "").trim();
      const nextExpiresAt = String(payload.expiresAt || "").trim();
      if (!response.ok || !nextPairingUrl || !nextExpiresAt) {
        throw new Error(payload.error || "Unable to generate phone pairing QR.");
      }
      setPairingState({
        status: "ready",
        pairingUrl: nextPairingUrl,
        expiresAt: nextExpiresAt,
      });
    } catch (error) {
      setPairingState({
        status: "error",
        error: error instanceof Error ? error.message : "Unable to generate phone pairing QR.",
      });
    }
  };

  const copyPairingUrl = async () => {
    if (!pairingUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(pairingUrl);
      setDidCopy(true);
      window.setTimeout(() => setDidCopy(false), 1600);
    } catch (error) {
      setPairingState({
        status: "error",
        error: error instanceof Error ? error.message : "Unable to copy pairing URL.",
      });
    }
  };

  return (
    <section className="phone-pairing-panel" aria-label="Phone pairing">
      <div className="phone-pairing-heading">
        <h2>Pair phone</h2>
        <Button disabled={!canGenerate} onClick={generatePairingRequest} size="sm" type="button" variant="secondary">
          {pairingState.status === "ready" ? "Generate new QR" : "Pair phone"}
        </Button>
      </div>
      {!decisionGatewayConfigured ? (
        <p className="phone-pairing-message">Set DECISION_GATEWAY_URL and restart TaskDeck to enable phone pairing.</p>
      ) : null}
      {pairingState.status === "loading" ? <p className="phone-pairing-message">Generating QR...</p> : null}
      {pairingState.status === "error" ? <p className="phone-pairing-error">{pairingState.error}</p> : null}
      {pairingState.status === "ready" ? (
        <div className="phone-pairing-result">
          <div className="phone-pairing-qr" aria-label="Phone pairing QR code">
            <QRCodeSVG value={pairingState.pairingUrl} size={164} level="M" includeMargin />
          </div>
          <p className="phone-pairing-expiry" data-expired={isExpired ? "true" : undefined}>
            {isExpired ? "Expired" : "Expires"} {expiryLabel}
          </p>
          <label className="phone-pairing-url">
            <span>Pairing URL</span>
            <input readOnly value={pairingState.pairingUrl} />
          </label>
          <Button fullWidth onClick={copyPairingUrl} size="sm" type="button" variant="secondary">
            {didCopy ? "Copied" : "Copy URL"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function pairingExpired(expiresAt: string) {
  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
}

function formatExpiry(expiresAt: string) {
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return expiresAt;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(expiresAtMs);
}
