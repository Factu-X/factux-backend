import "temporal-polyfill/global";
import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";

import { calcularCufe } from "../src/modules/dian/cufe.js";
import {
  agruparIva,
  calcularTotales,
  construirFacturaXml,
  fechaHoraColombia,
  NS,
} from "../src/modules/dian/ubl.js";
import { documentoDemo } from "./fixtures/dian.js";

const text = (doc: Document, ns: string, name: string) =>
  doc.getElementsByTagNameNS(ns, name)[0]?.textContent;

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

describe("factura UBL 2.1", () => {
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

  it("genera un XML con el CUFE, los totales y las lineas", () => {
    const resultado = construirFacturaXml(documentoDemo());
    const doc = new DOMParser().parseFromString(resultado.xml, "text/xml");

    expect(doc.documentElement.namespaceURI).toBe(NS.invoice);
    expect(text(doc, NS.cbc, "UUID")).toBe(resultado.cufe);
    expect(resultado.cufe).toMatch(/^[0-9a-f]{96}$/);
    expect(text(doc, NS.cbc, "IssueDate")).toBe("2026-10-21");
    expect(text(doc, NS.cbc, "IssueTime")).toBe("10:30:00-05:00");
    expect(text(doc, NS.cbc, "PayableAmount")).toBe("101630.00");
    expect(text(doc, NS.cbc, "TaxExclusiveAmount")).toBe("77000.00");
    expect(doc.getElementsByTagNameNS(NS.cac, "InvoiceLine")).toHaveLength(3);
    expect(text(doc, NS.sts, "QRCode")).toBe(resultado.urlConsulta);
    expect(resultado.urlConsulta).toContain("catalogo-vpfe-hab.dian.gov.co");
    // La segunda extension queda vacia para la firma.
    const contents = doc.getElementsByTagNameNS(NS.ext, "ExtensionContent");
    expect(contents).toHaveLength(2);
    expect(contents[1]?.childNodes.length ?? 0).toBe(0);
  });

  it("el CUFE cambia si cambia el total", () => {
    const base = documentoDemo();
    const otro = documentoDemo();
    otro.lineas[0]!.subtotal = "36000.00";
    expect(construirFacturaXml(base).cufe).not.toBe(construirFacturaXml(otro).cufe);
  });
});
