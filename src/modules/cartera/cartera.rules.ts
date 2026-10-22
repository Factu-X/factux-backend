import "temporal-polyfill/global";

import { decimalFromScale, parseDecimalToScale } from "../../shared/decimal.js";

export type Antiguedad = "AL_DIA" | "D1_30" | "D31_60" | "D61_90" | "MAS_90";
export type EstadoPago = "PENDIENTE" | "PARCIAL" | "PAGADA" | "ANULADA";

export const ANTIGUEDADES: Antiguedad[] = ["AL_DIA", "D1_30", "D31_60", "D61_90", "MAS_90"];

export const centavos = (valor: string | number) => parseDecimalToScale(valor, 2, "monto");
export const pesos = (valor: bigint) => decimalFromScale(valor, 2);

export const antiguedad = (diasVencida: number): Antiguedad =>
  diasVencida <= 0 ? "AL_DIA" : diasVencida <= 30 ? "D1_30" : diasVencida <= 60 ? "D31_60" : diasVencida <= 90 ? "D61_90" : "MAS_90";

// Saldo = total - notas credito validadas - pagos. Nunca negativo: una nota sobre una factura ya pagada
// es una devolucion de dinero, no deja saldo a favor en esta cartera.
export const estadoCuenta = (input: {
  total: string;
  acreditado: bigint;
  pagado: bigint;
  vencimiento: Temporal.PlainDate;
  hoy: Temporal.PlainDate;
}) => {
  const total = centavos(input.total);
  const bruto = total - input.acreditado - input.pagado;
  const saldo = bruto > 0n ? bruto : 0n;
  const anulada = input.acreditado >= total;
  const diasVencida = saldo > 0n ? input.vencimiento.until(input.hoy, { largestUnit: "day" }).days : 0;

  const estadoPago: EstadoPago = anulada
    ? "ANULADA"
    : saldo === 0n
      ? "PAGADA"
      : input.pagado > 0n
        ? "PARCIAL"
        : "PENDIENTE";

  return {
    acreditado: pesos(input.acreditado),
    pagado: pesos(input.pagado),
    saldo: pesos(saldo),
    diasVencida: Math.max(0, diasVencida),
    antiguedad: antiguedad(diasVencida),
    estadoPago,
  };
};
