import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createCatalogoItemSchema } from "../src/modules/catalogo/catalogo.schemas.js";
import {
  buildFacturaXml,
  calcularCufe,
  calcularTotales,
} from "../src/modules/facturas/facturas.xml.js";
import type { FacturaXmlInput } from "../src/modules/facturas/facturas.xml.js";

const input: FacturaXmlInput = {
  numero: "SETP990000001",
  prefijo: "SETP",
  fechaEmision: "2026-10-15",
  horaEmision: "10:30:00-05:00",
  fechaVencimiento: null,
  formaPago: "CONTADO",
  ambiente: "HABILITACION",
  resolucion: {
    numero: "18760000001",
    vigenciaDesde: "2026-01-01",
    vigenciaHasta: "2027-12-31",
    rangoDesde: 990000000,
    rangoHasta: 995000000,
  },
  software: { id: "sw-123", pin: "12345" },
  claveTecnica: "fc8eac422eba16e22ffd8c6f94b3f40a6e38162c",
  emisor: {
    nit: "800197268",
    dv: "4",
    razonSocial: "Taller <Demo> & Cia SAS",
    nombreComercial: null,
    tipoPersona: "JURIDICA",
    responsabilidadesFiscales: "O-13",
    direccion: "Cra 45 # 80-23",
    ciudad: "Medellin",
    departamento: "Antioquia",
    codigoMunicipio: "05001",
    telefono: "3001234567",
    email: "facturacion@taller.co",
  },
  adquiriente: {
    tipoIdentificacion: "CC",
    numeroIdentificacion: "1020304050",
    dv: null,
    nombre: "Cliente Demo",
    direccion: null,
    telefono: null,
    email: "cliente@demo.co",
  },
  lineas: [
    {
      codigo: "SRV-1",
      descripcion: "Cambio de aceite",
      cantidad: "1.00",
      precioUnitario: "50000.00",
      subtotal: "50000.00",
      impuesto: "9500.00",
      tarifaIva: "19.00",
      tratamientoIva: "GRAVADO",
    },
    {
      codigo: "REP-5",
      descripcion: "Repuesto al 5%",
      cantidad: "1.00",
      precioUnitario: "10000.00",
      subtotal: "10000.00",
      impuesto: "500.00",
      tarifaIva: "5.00",
      tratamientoIva: "GRAVADO",
    },
    {
      codigo: "REP-1",
      descripcion: "Filtro exento",
      cantidad: "2.00",
      precioUnitario: "10000.00",
      subtotal: "20000.00",
      impuesto: "0.00",
      tarifaIva: "0.00",
      tratamientoIva: "EXENTO",
    },
    {
      codigo: "REP-2",
      descripcion: "Repuesto excluido",
      cantidad: "1.00",
      precioUnitario: "5000.00",
      subtotal: "5000.00",
      impuesto: "0.00",
      tarifaIva: "0.00",
      tratamientoIva: "EXCLUIDO",
    },
  ],
};

describe("calcularTotales", () => {
  it("groups VAT by rate and leaves excluded items out of the taxable base", () => {
    const totales = calcularTotales(input.lineas);
    expect(totales.valorBruto).toBe(8500000n);
    expect(totales.baseGravable).toBe(8000000n);
    expect(totales.iva).toBe(1000000n);
    expect(totales.total).toBe(9500000n);
    expect([...totales.porTarifa.keys()]).toEqual(["19.00", "5.00", "0.00"]);
    expect(totales.porTarifa.get("5.00")).toEqual({ base: 1000000n, impuesto: 50000n });
  });
});

describe("calcularCufe", () => {
  it("hashes the fields in the order defined by the Anexo Tecnico", () => {
    const expected = createHash("sha384")
      .update(
        "SETP990000001" +
          "2026-10-15" +
          "10:30:00-05:00" +
          "85000.00" +
          "01" +
          "10000.00" +
          "04" +
          "0.00" +
          "03" +
          "0.00" +
          "95000.00" +
          "800197268" +
          "1020304050" +
          "fc8eac422eba16e22ffd8c6f94b3f40a6e38162c" +
          "2",
      )
      .digest("hex");

    expect(calcularCufe(input)).toBe(expected);
    expect(expected).toHaveLength(96);
  });

  it("changes when any amount changes", () => {
    const otro = { ...input, lineas: [{ ...input.lineas[0]!, subtotal: "50001.00" }] };
    expect(calcularCufe(otro)).not.toBe(calcularCufe(input));
  });
});

describe("buildFacturaXml", () => {
  const { xml, cufe } = buildFacturaXml(input);

  it("includes the resolution, CUFE and totals", () => {
    expect(xml).toContain("<sts:InvoiceAuthorization>18760000001</sts:InvoiceAuthorization>");
    expect(xml).toContain("<sts:Prefix>SETP</sts:Prefix>");
    expect(xml).toContain(`<cbc:UUID schemeID="2" schemeName="CUFE-SHA384">${cufe}</cbc:UUID>`);
    expect(xml).toContain('<cbc:PayableAmount currencyID="COP">95000.00</cbc:PayableAmount>');
    expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="COP">80000.00</cbc:TaxExclusiveAmount>');
    expect(xml).toContain("<cbc:LineCountNumeric>4</cbc:LineCountNumeric>");
  });

  it("leaves an empty extension for the digital signature", () => {
    expect(xml).toContain("<ext:UBLExtension>\n      <ext:ExtensionContent/>");
    expect(xml).not.toContain("<ds:Signature");
  });

  it("escapes XML special characters", () => {
    expect(xml).toContain("Taller &lt;Demo&gt; &amp; Cia SAS");
    expect(xml).not.toContain("Taller <Demo>");
  });

  it("reports excluded lines without a tax total", () => {
    const excluida = xml.slice(xml.lastIndexOf("<cac:InvoiceLine>"));
    expect(excluida).toContain("Repuesto excluido");
    expect(excluida).not.toContain("<cac:TaxTotal>");
  });
});

describe("catalog VAT rates", () => {
  const item = { codigo: "R1", nombre: "Repuesto", tipo: "REPUESTO", precioVenta: 1000 };

  it("accepts the legal Colombian rates", () => {
    expect(createCatalogoItemSchema.safeParse({ ...item, tarifaIva: 19 }).success).toBe(true);
    expect(createCatalogoItemSchema.safeParse({ ...item, tarifaIva: 5 }).success).toBe(true);
    expect(
      createCatalogoItemSchema.safeParse({ ...item, tratamientoIva: "EXENTO", tarifaIva: 0 })
        .success,
    ).toBe(true);
  });

  it("rejects taxed items with a rate that does not exist", () => {
    expect(createCatalogoItemSchema.safeParse({ ...item, tarifaIva: 12 }).success).toBe(false);
    expect(createCatalogoItemSchema.safeParse({ ...item, tarifaIva: 0 }).success).toBe(false);
  });
});
