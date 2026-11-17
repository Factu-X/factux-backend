import "temporal-polyfill/global";
import { beforeEach, describe, expect, it, vi } from "vitest";

const T = vi.hoisted(() => {
  const TERMINALES = new Set(["all", "first", "update", "updateAndCount", "create", "createAll", "aggregate"]);
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
    public: {
      NotasCredito: modelo("NotasCredito"),
      DetallesNotaCredito: modelo("DetallesNotaCredito"),
      EnviosDian: modelo("EnviosDian"),
      ConfiguracionEmpresa: modelo("ConfiguracionEmpresa"),
      ConfiguracionDian: modelo("ConfiguracionDian"),
    },
  };
  db["transaction"] = (fn: (tx: unknown) => unknown) => fn(db);
  return {
    db, modelos, wheres,
    getFacturaById: vi.fn(), cargarContextoDian: vi.fn(), gateway: { enviarNotaCredito: vi.fn() },
    firmarXml: vi.fn(), guardarDocumento: vi.fn(), leerDocumento: vi.fn(), renderPdf: vi.fn(),
    construirXml: vi.fn(),
  };
});

vi.mock("@prisma/orm-postgres/orm-client", () => ({ and: (...a: unknown[]) => a, or: (...a: unknown[]) => a }));
vi.mock("../src/prisma/db.js", () => ({ db: T.db }));
vi.mock("../src/modules/facturas/facturas.service.js", () => ({ getFacturaById: T.getFacturaById }));
vi.mock("../src/modules/dian/dian.service.js", () => ({
  cargarContextoDian: T.cargarContextoDian,
  parteAdquirente: (c: { nombreRazonSocial: string }) => ({ nombre: c.nombreRazonSocial }),
}));
vi.mock("../src/modules/dian/pdf.js", () => ({ renderFacturaPdf: T.renderPdf }));
vi.mock("../src/modules/dian/signer.js", () => ({ firmarXml: T.firmarXml }));
vi.mock("../src/modules/dian/storage.js", () => ({ guardarDocumento: T.guardarDocumento, leerDocumento: T.leerDocumento }));
vi.mock("../src/modules/dian/ubl-nota-credito.js", async (importar) => ({
  ...(await importar<object>()),
  construirNotaCreditoXml: T.construirXml,
}));

const svc = await import("../src/modules/notas-credito/notas-credito.service.js");
const ctl = await import("../src/modules/notas-credito/notas-credito.controller.js");

const m = (n: string) => T.modelos[n]!;
const FACT = "550e8400-e29b-41d4-a716-446655440000";
const L1 = "550e8400-e29b-41d4-a716-4466554400a1";
const L2 = "550e8400-e29b-41d4-a716-4466554400a2";

const detalle = (id: string, extra: Record<string, unknown> = {}) => ({
  id, codigoItem: "P-" + id.slice(-2), descripcion: "Item " + id.slice(-2), cantidad: "2.00",
  precioUnitario: "10000.00", tarifaIva: "19.00", detalleOrden: { tratamientoIva: "GRAVADO" }, ...extra,
});
const factura = (extra: Record<string, unknown> = {}) => ({
  id: FACT, numero: "FE100", cufe: "cufe-1", estadoDian: "VALIDADA", formaPago: "CONTADO",
  fechaEmision: Temporal.Instant.from("2026-11-10T15:00:00Z"),
  cliente: { nombreRazonSocial: "Ana", tipoIdentificacion: "CC", numeroIdentificacion: "123", email: "a@a.co", telefono: "300" },
  orden: { numero: "OS1", kilometrajeIngreso: 5000, motocicleta: { placa: "ABC12D", marca: "Honda", modelo: "CB" } },
  detallesFacturas: [detalle(L1), detalle(L2, { detalleOrden: null, tarifaIva: "0.00", cantidad: "1.00" })],
  ...extra,
});
const nota = (extra: Record<string, unknown> = {}) => ({
  id: "n1", numero: "NC-000001", facturaId: FACT, estadoDian: "PENDIENTE_ENVIO", tipoAjuste: "TOTAL", motivo: "Devolucion",
  fechaEmision: Temporal.Instant.from("2026-11-11T15:00:00Z"), cude: null, xmlPath: null,
  subtotal: "30000.00", impuestos: "3800.00", total: "33800.00",
  factura: { id: FACT, numero: "FE100", cufe: "cufe-1", fechaEmision: Temporal.Instant.from("2026-11-10T15:00:00Z") },
  detallesNotaCreditos: [
    { descripcion: "Item a1", cantidad: "2.00", precioUnitario: "10000.00", subtotal: "20000.00", impuesto: "3800.00", tarifaIva: "19.00",
      detalleFactura: { codigoItem: "P-a1", detalleOrden: { tratamientoIva: "GRAVADO" } } },
    { descripcion: "Item a2", cantidad: "1.00", precioUnitario: "10000.00", subtotal: "10000.00", impuesto: "0.00", tarifaIva: "0.00", detalleFactura: null },
  ],
  ...extra,
});

beforeEach(() => {
  vi.resetAllMocks();
  for (const n of Object.keys(T.wheres)) T.wheres[n]!.length = 0;
});

describe("notas credito: consultas", () => {
  it("lista notas filtrando o no por factura", async () => {
    m("NotasCredito")["all"]!.mockResolvedValue([{ id: "n1" }]);
    expect(await svc.listNotasCredito({ facturaId: FACT })).toEqual([{ id: "n1" }]);
    expect(await svc.listNotasCredito({})).toEqual([{ id: "n1" }]);
  });

  it("devuelve 404 si la nota no existe y la nota si existe", async () => {
    m("NotasCredito")["first"]!.mockResolvedValueOnce(null).mockResolvedValueOnce(nota());
    await expect(svc.getNotaCreditoById("x")).rejects.toMatchObject({ statusCode: 404 });
    expect((await svc.getNotaCreditoById("n1")).numero).toBe("NC-000001");
    expect(T.wheres["NotasCredito"]).toContainEqual({ id: "n1" });
  });

  it("calcula lo acreditable por linea restando notas previas y marca si se puede acreditar", async () => {
    T.getFacturaById.mockResolvedValue(factura());
    m("DetallesNotaCredito")["all"]!.mockResolvedValue([
      { detalleFacturaId: L1, cantidad: "0.50" },
      { detalleFacturaId: L1, cantidad: "0.25" },
    ]);
    const r = await svc.getAcreditable(FACT);
    expect(r.puedeAcreditar).toBe(true);
    expect(r.lineas.map((l) => [l.id, l.disponible])).toEqual([[L1, "1.25"], [L2, "1.00"]]);
    // sin tratamiento de la orden: tarifa 0 => EXCLUIDO
    expect(r.lineas[1]!.tratamientoIva).toBe("EXCLUIDO");
  });

  it("no permite acreditar facturas sin CUFE o no validadas", async () => {
    m("DetallesNotaCredito")["all"]!.mockResolvedValue([]);
    T.getFacturaById.mockResolvedValue(factura({ cufe: null }));
    expect((await svc.getAcreditable(FACT)).puedeAcreditar).toBe(false);
    T.getFacturaById.mockResolvedValue(factura({ estadoDian: "ENVIADA" }));
    expect((await svc.getAcreditable(FACT)).puedeAcreditar).toBe(false);
  });
});

describe("notas credito: creacion", () => {
  beforeEach(() => {
    T.getFacturaById.mockResolvedValue(factura());
    m("DetallesNotaCredito")["all"]!.mockResolvedValue([]);
    m("NotasCredito")["create"]!.mockResolvedValue({ id: "n1" });
  });

  it("rechaza facturas no validadas o sin CUFE con 400", async () => {
    T.getFacturaById.mockResolvedValue(factura({ estadoDian: "RECHAZADA" }));
    await expect(svc.createNotaCredito({ facturaId: FACT, tipoAjuste: "TOTAL", motivo: "x" })).rejects.toMatchObject({ statusCode: 400 });
    T.getFacturaById.mockResolvedValue(factura({ cufe: null }));
    await expect(svc.createNotaCredito({ facturaId: FACT, tipoAjuste: "TOTAL", motivo: "x" })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("crea nota TOTAL con consecutivo NC-000001 si no hay notas y escribe totales y lineas", async () => {
    m("NotasCredito")["first"]!.mockResolvedValueOnce(undefined).mockResolvedValueOnce(nota());
    const r = await svc.createNotaCredito({ facturaId: FACT, tipoAjuste: "TOTAL", motivo: "Devolucion" }, "u1");
    expect(r.id).toBe("n1");
    expect(m("NotasCredito")["create"]).toHaveBeenCalledWith(expect.objectContaining({
      facturaId: FACT, creadaPor: "u1", numero: "NC-000001", tipoAjuste: "TOTAL", estadoDian: "PENDIENTE_ENVIO",
      subtotal: "30000.00", impuestos: "3800.00", total: "33800.00",
    }));
    const lineas = m("DetallesNotaCredito")["createAll"]!.mock.calls[0]![0];
    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toMatchObject({ notaCreditoId: "n1", detalleFacturaId: L1, cantidad: "2.00", impuesto: "3800.00", total: "23800.00" });
  });

  it("incrementa el consecutivo a partir de la ultima nota y usa creadaPor null sin usuario", async () => {
    m("NotasCredito")["first"]!.mockResolvedValueOnce({ numero: "NC-000041" }).mockResolvedValueOnce(nota());
    await svc.createNotaCredito({ facturaId: FACT, tipoAjuste: "PARCIAL", motivo: "m", lineas: [{ detalleFacturaId: L1, cantidad: 1 }] });
    expect(m("NotasCredito")["create"]).toHaveBeenCalledWith(expect.objectContaining({ numero: "NC-000042", creadaPor: null, total: "11900.00" }));
  });

  it("reintenta con otro numero si hay choque de unicidad y falla tras 3 intentos", async () => {
    const dup = Object.assign(new Error("duplicate key"), { code: "23505" });
    m("NotasCredito")["first"]!.mockResolvedValue(nota());
    m("NotasCredito")["create"]!.mockRejectedValueOnce(dup).mockResolvedValueOnce({ id: "n1" });
    await expect(svc.createNotaCredito({ facturaId: FACT, tipoAjuste: "TOTAL", motivo: "m" })).resolves.toBeTruthy();
    expect(m("NotasCredito")["create"]).toHaveBeenCalledTimes(2);

    m("NotasCredito")["create"]!.mockReset().mockRejectedValue(dup);
    await expect(svc.createNotaCredito({ facturaId: FACT, tipoAjuste: "TOTAL", motivo: "m" })).rejects.toBe(dup);
    expect(m("NotasCredito")["create"]).toHaveBeenCalledTimes(3);
  });

  it("propaga errores que no son de unicidad sin reintentar", async () => {
    const boom = new Error("caida");
    m("NotasCredito")["first"]!.mockResolvedValue(undefined);
    m("NotasCredito")["create"]!.mockRejectedValue(boom);
    await expect(svc.createNotaCredito({ facturaId: FACT, tipoAjuste: "TOTAL", motivo: "m" })).rejects.toBe(boom);
    expect(m("NotasCredito")["create"]).toHaveBeenCalledTimes(1);
  });
});

describe("notas credito: envio a la DIAN", () => {
  const ctx = () => ({ emisor: { nit: "1" }, ambiente: "2", software: {}, certificado: {}, gateway: T.gateway });
  const ok = { estado: "VALIDADO", codigo: "00", mensaje: "Aceptado", errores: [{ regla: "R1", mensaje: "aviso" }] };

  beforeEach(() => {
    T.cargarContextoDian.mockResolvedValue(ctx());
    T.getFacturaById.mockResolvedValue(factura());
    T.construirXml.mockReturnValue({ xml: "<xml/>", cude: "cude-1" });
    T.firmarXml.mockResolvedValue("<firmado/>");
    T.guardarDocumento.mockImplementation(async (ruta: string) => ruta);
    m("NotasCredito")["updateAndCount"]!.mockResolvedValue(1);
    m("EnviosDian")["aggregate"]!.mockResolvedValue({ total: 2 });
    T.gateway.enviarNotaCredito.mockResolvedValue(ok);
  });

  it("rechaza si ya esta validada (409) o si la factura no tiene CUFE (400)", async () => {
    m("NotasCredito")["first"]!.mockResolvedValueOnce(nota({ estadoDian: "VALIDADA" }));
    await expect(svc.enviarNotaCredito("n1")).rejects.toMatchObject({ statusCode: 409 });
    m("NotasCredito")["first"]!.mockResolvedValueOnce(nota({ factura: { ...nota().factura, cufe: null } }));
    await expect(svc.enviarNotaCredito("n1")).rejects.toMatchObject({ statusCode: 400 });
    m("NotasCredito")["first"]!.mockResolvedValueOnce(nota({ factura: null }));
    await expect(svc.enviarNotaCredito("n1")).rejects.toMatchObject({ statusCode: 400 });
    expect(m("NotasCredito")["updateAndCount"]).not.toHaveBeenCalled();
  });

  it("devuelve 409 si otra peticion ya tomo la nota", async () => {
    m("NotasCredito")["first"]!.mockResolvedValue(nota());
    m("NotasCredito")["updateAndCount"]!.mockResolvedValue(0);
    await expect(svc.enviarNotaCredito("n1")).rejects.toMatchObject({ statusCode: 409 });
    expect(T.gateway.enviarNotaCredito).not.toHaveBeenCalled();
  });

  it("envia, guarda la respuesta como intento 3 y marca la nota VALIDADA con su CUDE", async () => {
    m("NotasCredito")["first"]!.mockResolvedValue(nota());
    const r = await svc.enviarNotaCredito("n1");
    expect(r.resultado).toBe(ok);
    expect(T.firmarXml).toHaveBeenCalledWith("<xml/>", {});
    expect(T.gateway.enviarNotaCredito).toHaveBeenCalledWith("<firmado/>");
    expect(T.guardarDocumento).toHaveBeenCalledWith("respuestas/NC-000001-intento-3.json", expect.any(String), "application/json");
    expect(m("EnviosDian")["create"]).toHaveBeenCalledWith(expect.objectContaining({
      notaCreditoId: "n1", numeroIntento: 3, estado: "VALIDADO", codigoRespuesta: "00", mensajeRespuesta: "Aceptado\nR1: aviso",
    }));
    expect(m("NotasCredito")["update"]).toHaveBeenCalledWith({ estadoDian: "VALIDADA", cude: "cude-1", xmlPath: "notas-credito/NC-000001.xml" });
  });

  it("marca RECHAZADA cuando la DIAN rechaza", async () => {
    m("NotasCredito")["first"]!.mockResolvedValue(nota({ estadoDian: "RECHAZADA" }));
    T.gateway.enviarNotaCredito.mockResolvedValue({ estado: "RECHAZADO", codigo: null, mensaje: "No", errores: [] });
    await svc.enviarNotaCredito("n1");
    expect(m("NotasCredito")["update"]).toHaveBeenCalledWith(expect.objectContaining({ estadoDian: "RECHAZADA" }));
  });

  it("si el envio falla restaura el estado, registra ERROR_CONEXION y responde 503", async () => {
    m("NotasCredito")["first"]!.mockResolvedValue(nota({ estadoDian: "RECHAZADA" }));
    T.gateway.enviarNotaCredito.mockRejectedValue(new Error("timeout"));
    await expect(svc.enviarNotaCredito("n1")).rejects.toMatchObject({ statusCode: 503 });
    expect(m("NotasCredito")["update"]).toHaveBeenCalledWith({ estadoDian: "RECHAZADA" });
    expect(m("EnviosDian")["create"]).toHaveBeenCalledWith(expect.objectContaining({ estado: "ERROR_CONEXION", mensajeRespuesta: "timeout", numeroIntento: 3 }));
  });

  it("conserva el HttpError original y describe errores no-Error como desconocidos", async () => {
    m("NotasCredito")["first"]!.mockResolvedValue(nota());
    const http = Object.assign(new Error("firma invalida"), { statusCode: 422 });
    T.firmarXml.mockRejectedValueOnce(http);
    await expect(svc.enviarNotaCredito("n1")).rejects.toBe(http);
    T.firmarXml.mockRejectedValueOnce("texto");
    await expect(svc.enviarNotaCredito("n1")).rejects.toMatchObject({ statusCode: 503 });
    expect(m("EnviosDian")["create"]).toHaveBeenLastCalledWith(expect.objectContaining({ mensajeRespuesta: "Error desconocido" }));
  });
});

describe("notas credito: envios, xml y pdf", () => {
  it("lista los envios de una nota existente y 404 si no existe", async () => {
    m("NotasCredito")["first"]!.mockResolvedValueOnce(nota());
    m("EnviosDian")["all"]!.mockResolvedValue([{ numeroIntento: 2 }]);
    expect(await svc.listEnviosNota("n1")).toEqual([{ numeroIntento: 2 }]);
    m("NotasCredito")["first"]!.mockResolvedValueOnce(null);
    await expect(svc.listEnviosNota("x")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("entrega el XML solo si la nota ya tiene documento", async () => {
    m("NotasCredito")["first"]!.mockResolvedValueOnce(nota());
    await expect(svc.getXmlNota("n1")).rejects.toMatchObject({ statusCode: 400 });
    m("NotasCredito")["first"]!.mockResolvedValueOnce(nota({ xmlPath: "notas-credito/NC-000001.xml" }));
    T.leerDocumento.mockResolvedValue("<xml/>");
    expect(await svc.getXmlNota("n1")).toEqual({ nombre: "NC-000001.xml", contenido: "<xml/>" });
  });

  it("arma el PDF con datos de empresa, ambiente de produccion y concepto de la nota", async () => {
    m("NotasCredito")["first"]!.mockResolvedValue(nota({ tipoAjuste: "PARCIAL", cude: "cude-9" }));
    T.getFacturaById.mockResolvedValue(factura());
    m("ConfiguracionEmpresa")["first"]!.mockResolvedValue({ id: "e1", razonSocial: "Taller SAS", nit: "900", digitoVerificacion: "1", direccion: "Calle 1", telefono: "1", email: "t@t.co", regimenFiscal: "R" });
    m("ConfiguracionDian")["first"]!.mockResolvedValue({ ambiente: "PRODUCCION" });
    T.renderPdf.mockResolvedValue(Buffer.from("pdf"));
    const r = await svc.getPdfNota("n1");
    expect(r.nombre).toBe("NC-000001.pdf");
    const datos = T.renderPdf.mock.calls[0]![0];
    expect(datos).toMatchObject({
      numero: "NC-000001", cufe: "cude-9", ambiente: "1", resolucion: null,
      empresa: { razonSocial: "Taller SAS", nit: "900", dv: "1" },
      cliente: { nombre: "Ana", documento: "CC 123" },
      orden: { numero: "OS1", placa: "ABC12D", vehiculo: "Honda CB", kilometraje: 5000 },
      notaCredito: { facturaNumero: "FE100", facturaCufe: "cufe-1", motivo: "Devolucion" },
    });
    expect(datos.notaCredito.concepto).toContain("1 ·");
    expect(datos.lineas).toHaveLength(2);
  });

  it("arma el PDF con valores por defecto sin empresa ni orden", async () => {
    m("NotasCredito")["first"]!.mockResolvedValue(nota());
    T.getFacturaById.mockResolvedValue(factura({ orden: null }));
    m("ConfiguracionEmpresa")["first"]!.mockResolvedValue(null);
    T.renderPdf.mockResolvedValue(Buffer.from("pdf"));
    await svc.getPdfNota("n1");
    expect(T.renderPdf.mock.calls[0]![0]).toMatchObject({
      ambiente: "2", empresa: { razonSocial: "", nit: "", dv: null },
      orden: { numero: "", placa: "", vehiculo: "", kilometraje: 0 },
    });
    expect(m("ConfiguracionDian")["first"]).not.toHaveBeenCalled();
  });
});

describe("notas credito: controlador", () => {
  const res = () => {
    const r: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const k of ["json", "status", "type", "attachment", "send"]) r[k] = vi.fn(() => r);
    return r;
  };
  const llamar = async (h: unknown, req: Record<string, unknown>) => {
    const r = res();
    const next = vi.fn();
    (h as (a: unknown, b: unknown, c: unknown) => void)(req, r, next);
    await vi.waitFor(() => expect(r["json"]!.mock.calls.length + r["send"]!.mock.calls.length + next.mock.calls.length).toBeGreaterThan(0));
    return { r, next };
  };

  it("lista, obtiene, crea (201) y envia", async () => {
    m("NotasCredito")["all"]!.mockResolvedValue([]);
    m("NotasCredito")["first"]!.mockResolvedValue(nota());
    let x = await llamar(ctl.listNotasCreditoController, { query: {} });
    expect(x.r["json"]).toHaveBeenCalledWith({ data: [] });
    x = await llamar(ctl.getNotaCreditoController, { params: { id: "n1" } });
    expect(x.r["json"]).toHaveBeenCalledWith({ data: expect.objectContaining({ id: "n1" }) });

    T.getFacturaById.mockResolvedValue(factura());
    m("DetallesNotaCredito")["all"]!.mockResolvedValue([]);
    m("NotasCredito")["create"]!.mockResolvedValue({ id: "n1" });
    x = await llamar(ctl.createNotaCreditoController, { body: { facturaId: FACT, tipoAjuste: "TOTAL", motivo: "m" }, user: { id: "u1" } });
    expect(x.r["status"]).toHaveBeenCalledWith(201);
    expect(m("NotasCredito")["create"]).toHaveBeenCalledWith(expect.objectContaining({ creadaPor: "u1" }));

    m("NotasCredito")["first"]!.mockResolvedValue(nota({ estadoDian: "VALIDADA" }));
    x = await llamar(ctl.enviarNotaCreditoController, { params: { id: "n1" } });
    expect(x.next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
  });

  it("lista envios, acreditable, xml y pdf", async () => {
    m("NotasCredito")["first"]!.mockResolvedValue(nota({ xmlPath: "p.xml" }));
    m("EnviosDian")["all"]!.mockResolvedValue([]);
    let x = await llamar(ctl.listEnviosNotaController, { params: { id: "n1" } });
    expect(x.r["json"]).toHaveBeenCalledWith({ data: [] });

    T.getFacturaById.mockResolvedValue(factura());
    m("DetallesNotaCredito")["all"]!.mockResolvedValue([]);
    x = await llamar(ctl.getAcreditableController, { params: { id: FACT } });
    expect(x.r["json"]).toHaveBeenCalledWith({ data: expect.objectContaining({ facturaId: FACT }) });

    T.leerDocumento.mockResolvedValue("<x/>");
    x = await llamar(ctl.getXmlNotaController, { params: { id: "n1" } });
    expect(x.r["type"]).toHaveBeenCalledWith("application/xml");
    expect(x.r["attachment"]).toHaveBeenCalledWith("NC-000001.xml");
    expect(x.r["send"]).toHaveBeenCalledWith("<x/>");

    m("ConfiguracionEmpresa")["first"]!.mockResolvedValue(null);
    T.renderPdf.mockResolvedValue(Buffer.from("p"));
    x = await llamar(ctl.getPdfNotaController, { params: { id: "n1" } });
    expect(x.r["type"]).toHaveBeenCalledWith("application/pdf");
    expect(x.r["attachment"]).toHaveBeenCalledWith("NC-000001.pdf");
  });
});

describe("notas credito: reglas de calculo (parcial)", () => {
  const base = { facturaId: FACT, tipoAjuste: "PARCIAL" as const, motivo: "m" };
  const crear = (lineas: { detalleFacturaId: string; cantidad: number | string }[]) => {
    T.getFacturaById.mockResolvedValue(factura());
    m("DetallesNotaCredito")["all"]!.mockResolvedValue([{ detalleFacturaId: L1, cantidad: "1.50" }]);
    return svc.createNotaCredito({ ...base, lineas });
  };

  it("rechaza lineas ajenas, cantidades en cero, excesos y lineas repetidas con 400", async () => {
    await expect(crear([{ detalleFacturaId: "ajena", cantidad: 1 }])).rejects.toThrow(/no pertenece/);
    await expect(crear([{ detalleFacturaId: L1, cantidad: 0 }])).rejects.toThrow(/mayor que cero/);
    await expect(crear([{ detalleFacturaId: L1, cantidad: "0.51" }])).rejects.toThrow(/Solo quedan 0.50/);
    await expect(crear([{ detalleFacturaId: L2, cantidad: 1 }, { detalleFacturaId: L2, cantidad: 0.5 }])).rejects.toThrow();
    await expect(crear([])).rejects.toThrow(/al menos una linea/);
    expect(m("NotasCredito")["create"]).not.toHaveBeenCalled();
  });

  it("una nota TOTAL sobre una factura ya acreditada por completo falla con 400", async () => {
    T.getFacturaById.mockResolvedValue(factura());
    m("DetallesNotaCredito")["all"]!.mockResolvedValue([
      { detalleFacturaId: L1, cantidad: "2.00" }, { detalleFacturaId: L2, cantidad: "1.00" },
    ]);
    await expect(svc.createNotaCredito({ facturaId: FACT, tipoAjuste: "TOTAL", motivo: "m" })).rejects.toThrow(/totalmente acreditada/);
  });

  it("acredita solo lo que queda al aceptar la cantidad disponible exacta", async () => {
    m("NotasCredito")["first"]!.mockResolvedValueOnce(undefined).mockResolvedValueOnce(nota());
    m("NotasCredito")["create"]!.mockResolvedValue({ id: "n1" });
    await crear([{ detalleFacturaId: L1, cantidad: "0.50" }]);
    expect(m("NotasCredito")["create"]).toHaveBeenCalledWith(expect.objectContaining({ subtotal: "5000.00", impuestos: "950.00", total: "5950.00" }));
  });
});
