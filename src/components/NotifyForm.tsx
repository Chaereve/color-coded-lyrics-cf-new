import { useState } from "react";
import type { FormEvent } from "react";
import { CheckIcon, MailIcon } from "@/components/icons";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
const STORAGE_KEY = "chaereve.maintenance.notify";

type State = "idle" | "error" | "done";

/**
 * Stores the notification email locally for this demo. Replace the local
 * storage write with an API request when a subscription endpoint is ready.
 */
export default function NotifyForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>(() =>
    typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY)
      ? "done"
      : "idle",
  );
  const [savedEmail, setSavedEmail] = useState(
    () =>
      (typeof window !== "undefined" &&
        window.localStorage.getItem(STORAGE_KEY)) ||
      "",
  );
  const [error, setError] = useState("");

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setError("Please enter a valid email address.");
      setState("error");
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, value);
    setSavedEmail(value);
    setError("");
    setState("done");
  }

  function reset() {
    window.localStorage.removeItem(STORAGE_KEY);
    setSavedEmail("");
    setEmail("");
    setError("");
    setState("idle");
  }

  if (state === "done") {
    return (
      <div className="rise d8 mt-6 w-full">
        <div className="flex items-center gap-3 rounded-lg border border-done/30 bg-done/[0.08] px-4 py-3 text-left">
          <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-done/15 text-done">
            <CheckIcon className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-txt">
              Notification set for {savedEmail}
            </span>
            <span className="mt-0.5 block text-[12px] text-txt3">
              We will let you know as soon as Chaereve is back.
            </span>
          </span>
          <button
            type="button"
            onClick={reset}
            className="ml-auto flex-none text-[12px] text-txt3 underline decoration-line2 underline-offset-4 transition-colors hover:text-txt2"
          >
            Change email
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rise d8 mt-6 w-full">
      <label
        htmlFor="notify-email"
        className="mb-2.5 block text-center text-[12.5px] text-txt2"
      >
        Get notified when Chaereve is back:
      </label>
      <form onSubmit={handleSubmit} className="flex gap-2" noValidate>
        <span className="relative flex-1">
          <MailIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-txt3" />
          <input
            id="notify-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="ban@email.com"
            className="field pl-9"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (state === "error") setState("idle");
            }}
            aria-invalid={state === "error"}
            aria-describedby={state === "error" ? "notify-error" : undefined}
          />
        </span>
        <button type="submit" className="btn btn-primary">
          Notify me
        </button>
      </form>
      {state === "error" && (
        <p
          id="notify-error"
          role="alert"
          className="mt-2 text-center text-[12px] text-denied"
        >
          {error}
        </p>
      )}
    </div>
  );
}
