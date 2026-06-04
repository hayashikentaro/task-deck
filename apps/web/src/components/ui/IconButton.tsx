import type { ButtonHTMLAttributes, ReactNode } from "react";

export type IconButtonVariant = "panel" | "secondary" | "danger" | "ghost";
export type IconButtonSize = "sm" | "md";

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  label: string;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
};

export function IconButton({
  children,
  className,
  label,
  size = "md",
  type = "button",
  variant = "panel",
  ...props
}: IconButtonProps) {
  const classes = ["td-icon-button", className].filter(Boolean).join(" ");

  return (
    <button
      {...props}
      aria-label={label}
      className={classes}
      data-size={size}
      data-variant={variant}
      type={type}
    >
      {children}
    </button>
  );
}
