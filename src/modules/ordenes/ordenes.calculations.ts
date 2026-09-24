import { decimalFromScale, parseDecimalToScale, roundDiv } from "../../shared/decimal.js";
import type { DecimalInput } from "../../shared/decimal.js";

export type TratamientoIva = "GRAVADO" | "EXENTO" | "EXCLUIDO";

export type CalculateDetalleInput = {
  cantidad: DecimalInput;
  precioUnitario: DecimalInput;
  tratamientoIva: TratamientoIva;
  tarifaIva: DecimalInput;
};

export type CalculatedDetalle = {
  cantidad: string;
  precioUnitario: string;
  tarifaIva: string;
  subtotal: string;
  impuesto: string;
  total: string;
};

export const calculateDetalle = (input: CalculateDetalleInput): CalculatedDetalle => {
  const cantidadHundredths = parseDecimalToScale(input.cantidad, 2, "cantidad");
  const precioCents = parseDecimalToScale(input.precioUnitario, 2, "precioUnitario");
  const tarifaBasisPoints = parseDecimalToScale(input.tarifaIva, 2, "tarifaIva");

  const subtotalCents = roundDiv(cantidadHundredths * precioCents, 100n);
  const impuestoCents =
    input.tratamientoIva === "GRAVADO"
      ? roundDiv(subtotalCents * tarifaBasisPoints, 10000n)
      : 0n;
  const totalCents = subtotalCents + impuestoCents;

  return {
    cantidad: decimalFromScale(cantidadHundredths, 2),
    precioUnitario: decimalFromScale(precioCents, 2),
    tarifaIva: decimalFromScale(tarifaBasisPoints, 2),
    subtotal: decimalFromScale(subtotalCents, 2),
    impuesto: decimalFromScale(impuestoCents, 2),
    total: decimalFromScale(totalCents, 2),
  };
};

export const sumCalculatedDetalles = (
  detalles: Pick<CalculatedDetalle, "subtotal" | "impuesto" | "total">[],
) => {
  const totals = detalles.reduce(
    (accumulator, detalle) => ({
      subtotal: accumulator.subtotal + parseDecimalToScale(detalle.subtotal, 2, "subtotal"),
      impuestos: accumulator.impuestos + parseDecimalToScale(detalle.impuesto, 2, "impuesto"),
      total: accumulator.total + parseDecimalToScale(detalle.total, 2, "total"),
    }),
    { subtotal: 0n, impuestos: 0n, total: 0n },
  );

  return {
    subtotal: decimalFromScale(totals.subtotal, 2),
    impuestos: decimalFromScale(totals.impuestos, 2),
    total: decimalFromScale(totals.total, 2),
  };
};
