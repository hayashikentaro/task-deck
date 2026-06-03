import type { CSSProperties } from "react";

type TaskIdentityTokenProps = {
  className?: string;
  label?: string;
  style?: CSSProperties;
};

export function TaskIdentityToken({ className = "", label = "Task identity marker", style }: TaskIdentityTokenProps) {
  return (
    <span
      aria-label={label}
      className={["task-identity-token", className].filter(Boolean).join(" ")}
      role="img"
      style={style}
      title={label}
    >
      <span data-cell="a" />
      <span data-cell="b" />
      <span data-cell="c" />
      <span data-cell="d" />
    </span>
  );
}
