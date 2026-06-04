import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "panel" | "secondary" | "danger" | "icon";
export type ButtonSize = "sm" | "md";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  fullWidth?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export function Button({
  className,
  fullWidth = false,
  size = "md",
  type = "button",
  variant = "panel",
  ...props
}: ButtonProps) {
  const classes = ["td-button", className].filter(Boolean).join(" ");

  return (
    <button
      {...props}
      className={classes}
      data-full-width={fullWidth ? "true" : "false"}
      data-size={size}
      data-variant={variant}
      type={type}
    />
  );
}
