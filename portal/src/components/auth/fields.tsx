"use client";

import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { auth, cx } from "@/design/tokens";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon: IconName;
  /** Rendered opposite the label — a "forgot password" link, usually. */
  action?: ReactNode;
}

export function TextField({ label, icon, action, className, ...input }: FieldProps) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className={auth.label}>
          {label}
        </label>
        {action}
      </div>
      <div className="relative mt-1.5">
        <Icon
          name={icon}
          size={16}
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-white/45"
        />
        <input id={id} className={cx(auth.field, className)} {...input} />
      </div>
    </div>
  );
}

export function PasswordField({ label, icon, action, ...input }: FieldProps) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className={auth.label}>
          {label}
        </label>
        {action}
      </div>
      <div className="relative mt-1.5">
        <Icon
          name={icon}
          size={16}
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-white/45"
        />
        <input
          id={id}
          type={revealed ? "text" : "password"}
          className={cx(auth.field, "pr-11")}
          {...input}
        />
        <button
          type="button"
          onClick={() => setRevealed((value) => !value)}
          aria-label={revealed ? "Hide password" : "Show password"}
          className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-control text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Icon name={revealed ? "eyeOff" : "eye"} size={16} />
        </button>
      </div>
    </div>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-white/75">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={cx(
          "flex size-[17px] items-center justify-center rounded-[5px] border transition-colors",
          checked ? "border-white bg-white text-seal" : "border-white/30 bg-white/10",
        )}
      >
        {checked && <Icon name="check" size={12} strokeWidth={2.6} />}
      </span>
      {label}
    </label>
  );
}

export function Divider({ label }: { label: string }) {
  return (
    <div className={auth.divider}>
      <span className={auth.rule} />
      {label}
      <span className={auth.rule} />
    </div>
  );
}
