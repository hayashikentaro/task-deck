import { useId } from "react";
import type { ReactNode, SelectHTMLAttributes } from "react";

type NativeSelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "children" | "className" | "id" | "onChange" | "value"
>;

export type SelectFieldProps = NativeSelectProps & {
  children: ReactNode;
  className?: string;
  error?: ReactNode;
  hint?: ReactNode;
  id?: string;
  label: string;
  onChange: (value: string) => void;
  selectClassName?: string;
  value: string;
};

export function SelectField({
  children,
  className,
  error,
  hint,
  id,
  label,
  onChange,
  selectClassName,
  value,
  ...props
}: SelectFieldProps) {
  const generatedId = useId();
  const selectId = id || generatedId;
  const hintId = hint ? `${selectId}-hint` : undefined;
  const errorId = error ? `${selectId}-error` : undefined;
  const describedBy = [props["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined;
  const wrapperClasses = ["td-select-field", className].filter(Boolean).join(" ");
  const selectClasses = ["td-select-field__control", selectClassName].filter(Boolean).join(" ");

  return (
    <div className={wrapperClasses}>
      <label className="td-select-field__label" htmlFor={selectId}>
        {label}
      </label>
      <select
        {...props}
        aria-describedby={describedBy}
        aria-invalid={error ? "true" : undefined}
        className={selectClasses}
        id={selectId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
      {hint ? (
        <small className="td-select-field__hint" id={hintId}>
          {hint}
        </small>
      ) : null}
      {error ? (
        <small className="td-select-field__error" id={errorId}>
          {error}
        </small>
      ) : null}
    </div>
  );
}
