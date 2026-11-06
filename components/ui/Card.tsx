import clsx from "clsx";
import type { HTMLAttributes } from "react";

// The standard surface. Looks live in app/globals.css (.card).
type CardProps = HTMLAttributes<HTMLElement> & { as?: "div" | "section" | "article" | "li" | "aside" };

export function Card({ as: Tag = "div", className, ...props }: CardProps) {
  return <Tag className={clsx("card", className)} {...props} />;
}
