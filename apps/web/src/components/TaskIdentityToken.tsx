type TaskIdentityTokenProps = {
  className?: string;
  label?: string;
};

export function TaskIdentityToken({ className = "", label = "Task identity marker" }: TaskIdentityTokenProps) {
  return (
    <span
      aria-label={label}
      className={["task-identity-token", className].filter(Boolean).join(" ")}
      role="img"
      title={label}
    >
      <span data-cell="a" />
      <span data-cell="b" />
      <span data-cell="c" />
      <span data-cell="d" />
    </span>
  );
}
