import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

export type ButtonVariant = "panel" | "secondary" | "danger" | "icon";
export type ButtonSize = "sm" | "md";

type ButtonBaseProps = {
  className?: string;
  fullWidth?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

type NativeButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  ButtonBaseProps & {
    href?: undefined;
  };

type AnchorButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> &
  ButtonBaseProps & {
    href: string;
  };

export type ButtonProps = NativeButtonProps | AnchorButtonProps;

export function Button({
  className,
  fullWidth = false,
  size = "md",
  variant = "panel",
  ...props
}: ButtonProps) {
  const classes = ["td-button", className].filter(Boolean).join(" ");
  const sharedProps = {
    className: classes,
    "data-full-width": fullWidth ? "true" : "false",
    "data-size": size,
    "data-variant": variant,
  };

  if (props.href) {
    return <a {...props} {...sharedProps} />;
  }

  const { type = "button", ...buttonProps } = props;

  return (
    <button
      {...buttonProps}
      {...sharedProps}
      type={type}
    />
  );
}
