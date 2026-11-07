// Who may decide what. Shared by every platform module so the Constitution (ADR-0009) is enforced the same way everywhere.

/** NEX, other AI workers and the system never approve, pay, publish or change money. Only people do. */
export const isPerson = (actor: string): boolean => actor.trim() !== "" && !actor.startsWith("worker:") && actor !== "system";

/** An AI worker may prepare (Level 1). It never decides. */
export const isWorker = (actor: string): boolean => actor.startsWith("worker:");
