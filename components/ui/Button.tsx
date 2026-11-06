import clsx from "clsx";
import type { ButtonHTMLAttributes } from "react";

// One definition of every button in the product. Looks live in app/globals.css (.btn, .btn-primary, ...);
// use `buttonClass` for links and anything that is not a <button>.
export type ButtonVariant = "primary" | "secondary" | "accent" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

// Written out in full (not built with template strings) so Tailwind's scanner keeps these classes.
const VARIANT: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  accent: "btn-accent",
  ghost: "btn-ghost",
};
const SIZE: Record<ButtonSize, string> = { sm: "btn-sm", md: "btn-md", lg: "btn-lg" };

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return clsx("btn", VARIANT[variant], SIZE[size], className);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize };

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}
