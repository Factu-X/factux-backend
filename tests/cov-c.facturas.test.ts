import "temporal-polyfill/global";
import { beforeEach, describe, expect, it, vi } from "vitest";

const T = vi.hoisted(() => {
  const TERMINALES = new Set(["all", "first", "update", "create", "createAll"]);
  const deep: unknown = new Proxy(function () {}, { get: (_t, p) => (p === "then" ? undefined : deep), apply: () => deep });
  const modelos: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {};
  const wheres: Record<string, unknown[]> = {};
  const modelo = (nombre: string) => {
    modelos[nombre] = Object.fromEntries([...TERMINALES].map((t) => [t, vi.fn()]));
    wheres[nombre] = [];
    const cadena: unknown = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then") return undefined;
        if (TERMINALES.has(prop)) {
          return (...args: unknown[]) => {
            for (const a of args) if (typeof a === "function") a(deep);
            return modelos[nombre]![prop]!(...args);
          };
        }
        return (...args: unknown[]) => {
          for (const a of args) {
            if (typeof a === "function") a(deep);
            else if (prop === "where") wheres[nombre]!.push(a);
          }
          return cadena;
        };
      },
    });
    return cadena;
  };
  const db: Record<string, unknown> = {};
  db["orm"] = {
    public: Object.fromEntries(
      ["Facturas", "DetallesFactura", "OrdenesServicio", "DetallesOrden", "Clientes", "ConfiguracionDian"].map((n) => [n, modelo(n)]),
    ),
  };
  db["transaction"] = (fn: (tx: unknown) => unknown) => fn(db);
  return {
    db, modelos, wheres,
    getConfiguracionEmision: vi.fn(), upload: vi.fn(), download: vi.fn(),
  };
});

vi.mock("@prisma/orm-postgres/orm-client", () => ({ and: (...a: unknown[]) => a, or: (...a: unknown[]) => a }));
vi.mock("../src/prisma/db.js", () => ({ db: T.db }));
vi.mock("../src/modules/configuracion/configuracion.service.js", () => ({
  BUCKET_PRIVADO: "bucket",
  getConfiguracionEmision: T.getConfiguracionEmision,
  requireSecretsClient: () => ({ storage: { from: () => ({ upload: T.upload, download: T.download }) } }),
}));

const svc = await import("../src/modules/facturas/facturas.service.js");
const ctl = await import("../src/modules/facturas/facturas.controller.js");

const m = (n: string) => T.modelos[n]!;
const ORDEN = "550e8400-e29b-41d4-a716-446655440000";

const config = () => ({
  claveTecnica: "clave", pin: "12345",
  numeracion: { id: "cfg1" },
  empresa: {
    nit: "900123456", digitoVerificacion: "7", razonSocial: "Taller SAS", nombreComercial: "Taller", tipoPersona: "JURIDICA",
    responsabilidadesFiscales: "O-13", direccion: "Calle 1", ciudad: "Medellin", departamento: "Antioquia",
    codigoMunicipio: "05001", telefono: "300", email: "t@t.co",
  },
});
const numeracion = (extra: Record<string, unknown> = {}) => ({
  id: "cfg1", consecutivoActual: 99, rangoDesde: 1, rangoHasta: 100, prefijoFacturacion: "SETP", ambiente: "HABILITACION",
  numeroResolucion: "18760000001", vigenciaDesde: Temporal.PlainDate.from("2026-01-01"),
  vigenciaHasta: Temporal.PlainDate.from("2027-12-31"), softwareId: "sw-1", ...extra,
});
const linea = (extra: Record<string, unknown> = {}) => ({
  id: "d1", codigoItem: "P1", nombreItem: "Aceite", cantidad: "3.00", precioUnitario: "333.33", tarifaIva: "19.00",
  tratamientoIva: "GRAVADO", subtotal: "999.99", impuesto: "190.00", total: "1189.99", ...extra,
});
const cliente = (extra: Record<string, unknown> = {}) => ({
  id: "c1", tipoIdentificacion: "CC", numeroIdentificacion: "123", digitoVerificacion: null, nombreRazonSocial: "Ana",
  direccion: null, telefono: null, email: null, ...extra,
});

// Configura el camino feliz de createFacturaFromOrden; cada prueba sobreescribe lo que necesita.
const preparar = (opts: { numeracion?: unknown; lineas?: unknown[]; cliente?: unknown; orden?: unknown } = {}) => {
  T.getConfiguracionEmision.mockResolvedValue(config());
  m("OrdenesServicio")["first"]!.mockResolvedValue("orden" in opts ? opts.orden : { id: ORDEN, estado: "FINALIZADA", clienteId: "c1" });
  m("Facturas")["first"]!.mockResolvedValueOnce(null).mockResolvedValue({ id: "f1", numero: "SETP100" });
  m("DetallesOrden")["all"]!.mockResolvedValue(opts.lineas ?? [linea()]);
  m("Clientes")["first"]!.mockResolvedValue("cliente" in opts ? opts.cliente : cliente());
  m("ConfiguracionDian")["first"]!.mockResolvedValue("numeracion" in opts ? opts.numeracion : numeracion());
  m("ConfiguracionDian")["update"]!.mockResolvedValue({ id: "cfg1" });
  m("Facturas")["create"]!.mockResolvedValue({ id: "f1" });
  T.upload.mockResolvedValue({ error: null });
};

beforeEach(() => {
  vi.resetAllMocks();
  for (const n of Object.keys(T.wheres)) T.wheres[n]!.length = 0;
});

describe("facturas: consultas", () => {
  it("lista aplicando filtros y paginacion sin fallar con o sin filtros", async () => {
    m("Facturas")["all"]!.mockResolvedValue([{ id: "f1" }]);
    expect(await svc.listFacturas({ limit: 10, offset: 0 })).toEqual([{ id: "f1" }]);
    expect(
      await svc.listFacturas({ search: "SETP", estadoDian: "VALIDADA", clienteId: "c1", formaPago: "CREDITO", limit: 5, offset: 5 }),
    ).toEqual([{ id: "f1" }]);
  });

  it("getFacturaById responde 404 cuando no existe", async () => {
    m("Facturas")["first"]!.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "f1" });
    await expect(svc.getFacturaById("x")).rejects.toMatchObject({ statusCode: 404 });
    expect(await svc.getFacturaById("f1")).toEqual({ id: "f1" });
  });

  it("listDetallesFactura valida que la factura exista", async () => {
    m("Facturas")["first"]!.mockResolvedValueOnce(null);
    await expect(svc.listDetallesFactura("x")).rejects.toMatchObject({ statusCode: 404 });
    m("Facturas")["first"]!.mockResolvedValueOnce({ id: "f1" });
    m("DetallesFactura")["all"]!.mockResolvedValue([{ id: "d1" }]);
    expect(await svc.listDetallesFactura("f1")).toEqual([{ id: "d1" }]);
  });

  it("construye las rutas del XML", () => {
    expect(svc.xmlPath("SETP1")).toBe("facturas/SETP1.xml");
    expect(svc.xmlFirmadoPath("SETP1")).toBe("facturas/SETP1.firmado.xml");
  });

  it("getFacturaXml: 404 sin factura, 404 sin documento y descarga el XML", async () => {
    m("Facturas")["first"]!.mockResolvedValueOnce(null);
    await expect(svc.getFacturaXml("x")).rejects.toMatchObject({ statusCode: 404 });
    m("Facturas")["first"]!.mockResolvedValueOnce({ id: "f1", numero: "A1", xmlPath: null });
    await expect(svc.getFacturaXml("f1")).rejects.toMatchObject({ statusCode: 404 });

    m("Facturas")["first"]!.mockResolvedValue({ id: "f1", numero: "A1", xmlPath: "facturas/A1.xml" });
    T.download.mockResolvedValueOnce({ data: { text: async () => "<xml/>" }, error: null });
    expect(await svc.getFacturaXml("f1")).toEqual({ numero: "A1", xml: "<xml/>" });
    expect(T.download).toHaveBeenCalledWith("facturas/A1.xml");

    const fallo = new Error("storage");
    T.download.mockResolvedValueOnce({ data: null, error: fallo });
    await expect(svc.getFacturaXml("f1")).rejects.toBe(fallo);
  });
});

describe("facturas: creacion, validaciones previas", () => {
  const credito = { ordenId: ORDEN, formaPago: "CREDITO" as const };

  it("rechaza fechaVencimiento invalida o anterior a hoy en facturas a credito", async () => {
    await expect(svc.createFacturaFromOrden({ ...credito, fechaVencimiento: "31/12/2030" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.createFacturaFromOrden({ ...credito, fechaVencimiento: "2020-01-01" })).rejects.toThrow(/anterior a hoy/);
    expect(T.getConfiguracionEmision).not.toHaveBeenCalled();
  });

  it("propaga el 400 de configuracion incompleta antes de tocar la base", async () => {
    T.getConfiguracionEmision.mockRejectedValue(Object.assign(new Error("incompleta"), { statusCode: 400 }));
    await expect(svc.createFacturaFromOrden({ ordenId: ORDEN, formaPago: "CONTADO" })).rejects.toMatchObject({ statusCode: 400 });
    expect(m("OrdenesServicio")["first"]).not.toHaveBeenCalled();
  });

  it("404 si la orden no existe y 400 si no esta FINALIZADA", async () => {
    preparar({ orden: null });
    await expect(svc.createFacturaFromOrden({ ordenId: ORDEN, formaPago: "CONTADO" })).rejects.toMatchObject({ statusCode: 404 });
    preparar({ orden: { id: ORDEN, estado: "EN_PROCESO", clienteId: "c1" } });
    await expect(svc.createFacturaFromOrden({ ordenId: ORDEN, formaPago: "CONTADO" })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("409 si la orden ya tiene factura", async () => {
    preparar();
    m("Facturas")["first"]!.mockReset().mockResolvedValue({ id: "otra" });
    await expect(svc.createFacturaFromOrden({ ordenId: ORDEN, formaPago: "CONTADO" })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("400 si la orden no tiene detalles", async () => {
    preparar({ lineas: [] });
    await expect(svc.createFacturaFromOrden({ ordenId: ORDEN, formaPago: "CONTADO" })).rejects.toThrow(/sin detalles/);
  });

  it("404 sin cliente y 400 si un NIT no tiene digito de verificacion", async () => {
    preparar({ cliente: null });
    await expect(svc.createFacturaFromOrden({ ordenId: ORDEN, formaPago: "CONTADO" })).rejects.toMatchObject({ statusCode: 404 });
    preparar({ cliente: cliente({ tipoIdentificacion: "NIT", digitoVerificacion: null }) });
    await expect(svc.createFacturaFromOrden({ ordenId: ORDEN, formaPago: "CONTADO" })).rejects.toThrow(/digito de verificacion/);
  });
});

describe("facturas: numeracion y consecutivo", () => {
  const input = { ordenId: ORDEN, formaPago: "CONTADO" as const };

  it("emite el ultimo numero del rango (100) y guarda el consecutivo reservado", async () => {
    preparar();
    await svc.createFacturaFromOrden(input, "u1");
    expect(m("ConfiguracionDian")["update"]).toHaveBeenCalledWith({ consecutivoActual: 100 });
    expect(T.wheres["ConfiguracionDian"]).toContainEqual({ id: "cfg1", consecutivoActual: 99 });
    expect(m("Facturas")["create"]).toHaveBeenCalledWith(expect.objectContaining({
      prefijo: "SETP", consecutivo: 100, numero: "SETP100", creadaPor: "u1", estadoDian: "PENDIENTE_ENVIO",
      xmlPath: "facturas/SETP100.xml", fechaVencimiento: null,
    }));
  });

  it("400 cuando el rango autorizado esta agotado y no reserva consecutivo", async () => {
    preparar({ numeracion: numeracion({ consecutivoActual: 100 }) });
    await expect(svc.createFacturaFromOrden(input)).rejects.toThrow(/agotado/);
    expect(m("ConfiguracionDian")["update"]).not.toHaveBeenCalled();
    expect(m("Facturas")["create"]).not.toHaveBeenCalled();
    expect(T.upload).not.toHaveBeenCalled();
  });

  it("400 cuando el consecutivo o el rango final no estan configurados", async () => {
    preparar({ numeracion: numeracion({ consecutivoActual: null }) });
    await expect(svc.createFacturaFromOrden(input)).rejects.toThrow(/numeracion/);
    preparar({ numeracion: numeracion({ rangoHasta: null }) });
    await expect(svc.createFacturaFromOrden(input)).rejects.toThrow(/numeracion/);
    preparar({ numeracion: null });
    await expect(svc.createFacturaFromOrden(input)).rejects.toThrow(/numeracion/);
  });

  it("arranca en rangoDesde si el consecutivo actual esta por debajo del rango", async () => {
    preparar({ numeracion: numeracion({ consecutivoActual: 0, rangoDesde: 5000, rangoHasta: 6000 }) });
    await svc.createFacturaFromOrden(input);
    expect(m("Facturas")["create"]).toHaveBeenCalledWith(expect.objectContaining({ consecutivo: 5000, numero: "SETP5000" }));
  });

  it("numero sin prefijo cuando la resolucion no lo tiene", async () => {
    preparar({ numeracion: numeracion({ prefijoFacturacion: null }) });
    await svc.createFacturaFromOrden(input);
    expect(m("Facturas")["create"]).toHaveBeenCalledWith(expect.objectContaining({ prefijo: null, numero: "100" }));
  });

  it("409 si otra transaccion tomo el consecutivo al mismo tiempo", async () => {
    preparar();
    m("ConfiguracionDian")["update"]!.mockResolvedValue(null);
    await expect(svc.createFacturaFromOrden(input)).rejects.toMatchObject({ statusCode: 409 });
    expect(m("Facturas")["create"]).not.toHaveBeenCalled();
  });

  it("traduce una violacion de unicidad en 409 y deja pasar otros errores", async () => {
    preparar();
    m("Facturas")["create"]!.mockRejectedValue(Object.assign(new Error("dup"), { code: "23505" }));
    await expect(svc.createFacturaFromOrden(input)).rejects.toMatchObject({ statusCode: 409 });
    const boom = new Error("caida");
    preparar();
    m("Facturas")["create"]!.mockRejectedValue(boom);
    await expect(svc.createFacturaFromOrden(input)).rejects.toBe(boom);
  });

  it("si falla la subida del XML propaga el error (la transaccion se revierte)", async () => {
    preparar();
    const err = new Error("sin espacio");
    T.upload.mockResolvedValue({ error: err });
    await expect(svc.createFacturaFromOrden(input)).rejects.toBe(err);
  });
});

describe("facturas: totales e IVA", () => {
  const input = { ordenId: ORDEN, formaPago: "CONTADO" as const };

  it("suma subtotal, IVA y total de varias lineas sin errores de redondeo", async () => {
    preparar({
      lineas: [
        linea({ id: "d1", subtotal: "999.99", impuesto: "190.00", total: "1189.99" }),
        linea({ id: "d2", codigoItem: "P2", subtotal: "0.01", impuesto: "0.00", total: "0.01" }),
        linea({ id: "d3", codigoItem: "P3", subtotal: "10.10", impuesto: "1.92", total: "12.02" }),
      ],
    });
    await svc.createFacturaFromOrden(input);
    expect(m("Facturas")["create"]).toHaveBeenCalledWith(expect.objectContaining({
      subtotal: "1010.10", impuestos: "191.92", total: "1202.02",
    }));
  });

  it("las lineas EXCLUIDAS suman al subtotal pero no al IVA; las EXENTAS tienen IVA 0", async () => {
    preparar({
      lineas: [
        linea({ id: "d1", subtotal: "100.00", impuesto: "19.00", total: "119.00" }),
        linea({ id: "d2", codigoItem: "P2", tratamientoIva: "EXCLUIDO", tarifaIva: "0.00", subtotal: "50.00", impuesto: "0.00", total: "50.00" }),
        linea({ id: "d3", codigoItem: "P3", tratamientoIva: "EXENTO", tarifaIva: "0.00", subtotal: "25.50", impuesto: "0.00", total: "25.50" }),
      ],
    });
    await svc.createFacturaFromOrden(input);
    expect(m("Facturas")["create"]).toHaveBeenCalledWith(expect.objectContaining({
      subtotal: "175.50", impuestos: "19.00", total: "194.50",
    }));
  });

  it("copia las lineas de la orden a la factura con sus valores calculados", async () => {
    preparar();
    await svc.createFacturaFromOrden(input);
    const filas = m("DetallesFactura")["createAll"]!.mock.calls[0]![0];
    expect(filas).toEqual([
      expect.objectContaining({ facturaId: "f1", detalleOrdenId: "d1", codigoItem: "P1", cantidad: "3.00", subtotal: "999.99", impuesto: "190.00", total: "1189.99" }),
    ]);
  });

  it("factura una orden con repuesto de tercero (sin item de catalogo) y conserva el proveedor", async () => {
    preparar({ lineas: [linea({ id: "d9", codigoItem: "TER", nombreItem: "Bujia", itemCatalogoId: null, proveedorTercero: "Taller Pepe" })] });
    await svc.createFacturaFromOrden(input);
    const filas = m("DetallesFactura")["createAll"]!.mock.calls[0]![0];
    expect(filas).toEqual([expect.objectContaining({ detalleOrdenId: "d9", codigoItem: "TER", descripcion: "Bujia", proveedorTercero: "Taller Pepe" })]);
  });

  it("en credito guarda la fecha de vencimiento y sube el XML al bucket", async () => {
    preparar();
    await svc.createFacturaFromOrden({ ordenId: ORDEN, formaPago: "CREDITO", fechaVencimiento: "2999-01-31" });
    const datos = m("Facturas")["create"]!.mock.calls[0]![0];
    expect(datos.fechaVencimiento.toString()).toBe("2999-01-31");
    expect(T.upload).toHaveBeenCalledWith("facturas/SETP100.xml", expect.stringContaining("SETP100"), { contentType: "application/xml", upsert: true });
  });

  it("de contado ignora la fechaVencimiento enviada", async () => {
    preparar();
    await svc.createFacturaFromOrden({ ordenId: ORDEN, formaPago: "CONTADO", fechaVencimiento: "2020-01-01" });
    expect(m("Facturas")["create"]).toHaveBeenCalledWith(expect.objectContaining({ fechaVencimiento: null }));
  });
});

describe("facturas: controlador", () => {
  const llamar = async (h: unknown, req: Record<string, unknown>) => {
    const r: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const k of ["json", "status", "type", "attachment", "send"]) r[k] = vi.fn(() => r);
    const next = vi.fn();
    (h as (a: unknown, b: unknown, c: unknown) => void)(req, r, next);
    await vi.waitFor(() => expect(r["json"]!.mock.calls.length + r["send"]!.mock.calls.length + next.mock.calls.length).toBeGreaterThan(0));
    return { r, next };
  };

  it("lista con query validada y obtiene por id", async () => {
    m("Facturas")["all"]!.mockResolvedValue([{ id: "f1" }]);
    let x = await llamar(ctl.listFacturasController, { query: { limit: "10" } });
    expect(x.r["json"]).toHaveBeenCalledWith({ data: [{ id: "f1" }] });
    m("Facturas")["first"]!.mockResolvedValue({ id: "f1" });
    x = await llamar(ctl.getFacturaController, { params: { id: "f1" } });
    expect(x.r["json"]).toHaveBeenCalledWith({ data: { id: "f1" } });
    m("DetallesFactura")["all"]!.mockResolvedValue([]);
    x = await llamar(ctl.listDetallesFacturaController, { params: { id: "f1" } });
    expect(x.r["json"]).toHaveBeenCalledWith({ data: [] });
  });

  it("crea con 201 y reenvia errores a next", async () => {
    preparar();
    let x = await llamar(ctl.createFacturaController, { body: { ordenId: ORDEN, formaPago: "CONTADO" }, user: { id: "u1" } });
    expect(x.r["status"]).toHaveBeenCalledWith(201);
    preparar({ orden: null });
    x = await llamar(ctl.createFacturaController, { body: { ordenId: ORDEN, formaPago: "CONTADO" } });
    expect(x.next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it("descarga el XML como adjunto", async () => {
    m("Facturas")["first"]!.mockResolvedValue({ id: "f1", numero: "A1", xmlPath: "facturas/A1.xml" });
    T.download.mockResolvedValue({ data: { text: async () => "<x/>" }, error: null });
    const x = await llamar(ctl.getFacturaXmlController, { params: { id: "f1" } });
    expect(x.r["type"]).toHaveBeenCalledWith("application/xml");
    expect(x.r["attachment"]).toHaveBeenCalledWith("A1.xml");
    expect(x.r["send"]).toHaveBeenCalledWith("<x/>");
  });
});
