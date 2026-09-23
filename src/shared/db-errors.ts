type UnknownRecord = Record<string, unknown>;

const asRecord = (error: unknown): UnknownRecord | null =>
  typeof error === "object" && error !== null ? (error as UnknownRecord) : null;

export const isUniqueConstraintError = (error: unknown) => {
  const record = asRecord(error);
  const code = record?.["code"];
  const message = error instanceof Error ? error.message : "";

  return (
    code === "23505" ||
    code === "P2002" ||
    message.toLowerCase().includes("duplicate key") ||
    message.toLowerCase().includes("unique constraint")
  );
};

export const isForeignKeyError = (error: unknown) => {
  const record = asRecord(error);
  const code = record?.["code"];
  const message = error instanceof Error ? error.message : "";

  return code === "23503" || message.toLowerCase().includes("foreign key");
};
