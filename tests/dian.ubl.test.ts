import "temporal-polyfill/global";
import { describe, expect, it } from "vitest";

import { calcularCufe } from "../src/modules/dian/cufe.js";
import { agruparIva, calcularTotales, fechaHoraColombia } from "../src/modules/dian/ubl.js";
import { documentoDemo } from "./fixtures/dian.js";

describe("CUFE", () => {
  it("reproduce el ejemplo del anexo tecnico", () => {
    expect(
      calcularCufe(
        {
          numero: "323200000129",
          fecha: "2019-01-16",
          hora: "10:53:10-05:00",
          valorBruto: "1500000.00",
          iva: "285000.00",
          inc: "0.00",
          ica: "0.00",
          valorTotal: "1785000.00",
          nitEmisor: "700085371",
          documentoAdquirente: "800199436",
          ambiente: "1",
        },
        "693ff6f2a553c3646a063436fd4dd9ded0311471",
      ),
    ).toBe(
      "8bb918b19ba22a694f1da11c643b5e9de39adf60311cf179179e9b33381030bcd4c3c3f156c506ed5908f9276f5bd9b4",
    );
  });
});

describe("helpers UBL de nota credito y PDF", () => {
  it("usa la hora de Colombia", () => {
    expect(fechaHoraColombia(Temporal.Instant.from("2026-10-21T03:05:09Z"))).toEqual({
      fecha: "2026-10-20",
      hora: "22:05:09-05:00",
    });
  });

  it("deja los excluidos fuera de la base gravable", () => {
    const { lineas } = documentoDemo();
    expect(calcularTotales(lineas)).toEqual({
      bruto: "87000.00",
      iva: "14630.00",
      baseGravable: "77000.00",
      total: "101630.00",
    });
    expect(agruparIva(lineas)).toEqual([{ tarifa: "19.00", base: "77000.00", impuesto: "14630.00" }]);
  });
});
