import { badRequest } from "./http-error.js";

export type DecimalInput = number | string;

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

const normalizeDecimalText = (value: DecimalInput, fieldName: string) => {
  const text = typeof value === "number" ? value.toString() : value.trim();

  if (!text || !DECIMAL_PATTERN.test(text)) {
    throw badRequest(`${fieldName} debe ser un numero decimal valido`);
  }

  return text;
};

export const parseDecimalToScale = (
  value: DecimalInput,
  scale: number,
  fieldName: string,
): bigint => {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw badRequest(`${fieldName} debe ser un numero finito`);
  }

  const text = normalizeDecimalText(value, fieldName);
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [wholePart, fractionPart = ""] = unsigned.split(".");

  if (fractionPart.length > scale) {
    throw badRequest(`${fieldName} admite maximo ${scale} decimales`);
  }

  const paddedFraction = fractionPart.padEnd(scale, "0");
  const scaled = BigInt(`${wholePart}${paddedFraction}`);

  return negative ? -scaled : scaled;
};

export const decimalFromScale = (value: bigint, scale: number) => {
  const negative = value < 0n;
  const unsigned = negative ? -value : value;
  const divisor = 10n ** BigInt(scale);
  const whole = unsigned / divisor;
  const fraction = (unsigned % divisor).toString().padStart(scale, "0");

  return `${negative ? "-" : ""}${whole.toString()}${scale > 0 ? `.${fraction}` : ""}`;
};

export const roundDiv = (dividend: bigint, divisor: bigint) => {
  if (divisor <= 0n) {
    throw new Error("El divisor debe ser positivo");
  }

  return (dividend + divisor / 2n) / divisor;
};
