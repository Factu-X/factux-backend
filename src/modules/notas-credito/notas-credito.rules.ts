import { decimalFromScale, parseDecimalToScale } from "../../shared/decimal.js";
import { badRequest } from "../../shared/http-error.js";
import { calculateDetalle, sumCalculatedDetalles, type TratamientoIva } from "../ordenes/ordenes.calculations.js";

export type LineaFacturada = {
  id: string;
  codigoItem: string | null;
  descripcion: string;
  cantidad: string;
  precioUnitario: string;
  tarifaIva: string;
  tratamientoIva: TratamientoIva;
};

export type LineaAcreditada = { detalleFacturaId: string | null; cantidad: string };
export type LineaSolicitada = { detalleFacturaId: string; cantidad: number | string };

const centesimas = (valor: number | string) => parseDecimalToScale(valor, 2, "cantidad");

// Cuanto queda por acreditar de cada linea: lo facturado menos lo que ya cubren notas anteriores.
export const disponiblesPorLinea = (lineas: LineaFacturada[], acreditadas: LineaAcreditada[]) =>
  new Map(
    lineas.map((linea) => {
      const usado = acreditadas
        .filter((a) => a.detalleFacturaId === linea.id)
        .reduce((total, a) => total + centesimas(a.cantidad), 0n);
      const disponible = centesimas(linea.cantidad) - usado;
      return [linea.id, disponible > 0n ? disponible : 0n];
    }),
  );

export const calcularLineasNota = (
  tipoAjuste: "TOTAL" | "PARCIAL",
  lineas: LineaFacturada[],
  acreditadas: LineaAcreditada[],
  solicitadas: LineaSolicitada[] = [],
) => {
  const disponibles = disponiblesPorLinea(lineas, acreditadas);
  const porId = new Map(lineas.map((linea) => [linea.id, linea]));

  const pedidos: { linea: LineaFacturada; cantidad: bigint }[] =
    tipoAjuste === "TOTAL"
      ? lineas.map((linea) => ({ linea, cantidad: disponibles.get(linea.id) ?? 0n })).filter((p) => p.cantidad > 0n)
      : solicitadas.map((s) => {
          const linea = porId.get(s.detalleFacturaId);
          if (!linea) throw badRequest("Una de las lineas no pertenece a la factura");
          const cantidad = centesimas(s.cantidad);
          const disponible = disponibles.get(linea.id) ?? 0n;
          if (cantidad <= 0n) throw badRequest(`La cantidad de "${linea.descripcion}" debe ser mayor que cero`);
          if (cantidad > disponible) {
            throw badRequest(
              `Solo quedan ${decimalFromScale(disponible, 2)} de "${linea.descripcion}" por acreditar`,
            );
          }
          return { linea, cantidad };
        });

  if (tipoAjuste === "PARCIAL" && new Set(solicitadas.map((s) => s.detalleFacturaId)).size !== solicitadas.length) {
    throw badRequest("Cada linea de la factura solo puede aparecer una vez");
  }

  const calculadas = pedidos
    .map(({ linea, cantidad }) => ({
      detalleFacturaId: linea.id,
      codigoItem: linea.codigoItem,
      descripcion: linea.descripcion,
      tratamientoIva: linea.tratamientoIva,
      ...calculateDetalle({
        cantidad: decimalFromScale(cantidad, 2),
        precioUnitario: linea.precioUnitario,
        tratamientoIva: linea.tratamientoIva,
        tarifaIva: linea.tarifaIva,
      }),
    }))
    // Una linea de valor cero no ajusta nada (y la base exige total > 0).
    .filter((linea) => centesimas(linea.total) > 0n);

  if (calculadas.length === 0) {
    throw badRequest(
      tipoAjuste === "TOTAL"
        ? "La factura ya esta totalmente acreditada por notas anteriores"
        : "Selecciona al menos una linea con cantidad a acreditar",
    );
  }

  return { lineas: calculadas, totales: sumCalculatedDetalles(calculadas) };
};
