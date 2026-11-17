import "temporal-polyfill/global";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getFactura: vi.fn(),
  emision: vi.fn(),
  certificado: vi.fn(),
  firmar: vi.fn(),
  guardar: vi.fn(),
  leer: vi.fn(),
  render: vi.fn(),
  gwEnviar: vi.fn(),
  gwArgs: [] as unknown[],
  updateAndCount: vi.fn(),
  facturaUpdate: vi.fn(),
  envioCreate: vi.fn(),
  aggregate: vi.fn(),
  envioAll: vi.fn(),
  empresaFirst: vi.fn(),
  dianFirst: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@prisma/orm-postgres/orm-client", () => ({
  and: (...a: unknown[]) => ({ and: a }),
  or: (...a: unknown[]) => ({ or: a }),
}));

vi.mock("../src/modules/facturas/facturas.service.js", () => ({
  getFacturaById: m.getFactura,
  xmlPath: (n: string) => `facturas/${n}.xml`,
  xmlFirmadoPath: (n: string) => `facturas/${n}.firmado.xml`,
}));
vi.mock("../src/modules/configuracion/configuracion.service.js", () => ({
  getConfiguracionEmision: m.emision,
  getCertificadoFirma: m.certificado,
}));
vi.mock("../src/modules/dian/signer.js", () => ({ firmarXml: m.firmar }));
vi.mock("../src/modules/dian/storage.js", () => ({ guardarDocumento: m.guardar, leerDocumento: m.leer }));
vi.mock("../src/modules/dian/pdf.js", () => ({ renderFacturaPdf: m.render }));
vi.mock("../src/modules/dian/gateway.js", () => ({
  SimuladorDianGateway: class {
    constructor(...args: unknown[]) {
      m.gwArgs = args;
    }
    enviarFactura = m.gwEnviar;
  },
}));

vi.mock("../src/prisma/db.js", () => {
  const db = {
    orm: {
      public: {
        Facturas: {
          where: (arg: unknown) => {
            if (typeof arg === "function") {
              const campo = (n: string) => ({ eq: (v: unknown) => ({ [n]: v }) });
              m.where(arg({ id: campo("id"), estadoDian: campo("estadoDian") }));
            }
            return { updateAndCount: m.updateAndCount, update: m.facturaUpdate };
          },
        },
        EnviosDian: {
          where: () => ({
            aggregate: (fn: (a: unknown) => unknown) => {
              fn({ count: () => "count" });
              return m.aggregate();
            },
            orderBy: (fn: (e: unknown) => unknown) => {
              fn({ numeroIntento: { desc: () => "desc" } });
              return { all: m.envioAll };
            },
          }),
          create: m.envioCreate,
        },
        ConfiguracionEmpresa: { where: () => ({ first: m.empresaFirst }) },
        ConfiguracionDian: { where: () => ({ first: m.dianFirst }) },
      },
    },
    transaction: (fn: (tx: unknown) => unknown) => fn(db),
  };
  return { db };
});

import {
  enviarFacturaController,
  getPdfController,
  listEnviosController,
} from "../src/modules/dian/dian.controller.js";
import {
  cargarContextoDian,
  enviarFactura,
  getPdfFactura,
  lineasFactura,
  listEnviosFactura,
  parteAdquirente,
} from "../src/modules/dian/dian.service.js";

const cliente = (extra: Record<string, unknown> = {}) => ({
  tipoIdentificacion: "CC",
  numeroIdentificacion: "1020304050",
  digitoVerificacion: null,
  nombreRazonSocial: "Carlos Perez",
  telefono: "300",
  email: "c@x.co",
  ...extra,
});

const detalle = (extra: Record<string, unknown> = {}) => ({
  codigoItem: "A1",
  descripcion: "Aceite",
  cantidad: "1.00",
  precioUnitario: "100.00",
  subtotal: "100.00",
  impuesto: "19.00",
  tarifaIva: "19.00",
  detalleOrden: { tratamientoIva: "GRAVADO" },
  ...extra,
});

const factura = (extra: Record<string, unknown> = {}) => ({
  id: "f1",
  numero: "SETP1",
  estadoDian: "PENDIENTE_ENVIO",
  xmlPath: "facturas/SETP1.xml",
  cufe: "c".repeat(96),
  formaPago: "CREDITO",
  fechaEmision: Temporal.Instant.from("2026-10-21T15:30:00Z"),
  fechaVencimiento: Temporal.PlainDate.from("2026-11-21"),
  subtotal: "100.00",
  impuestos: "19.00",
  total: "119.00",
  cliente: cliente(),
  detallesFacturas: [detalle()],
  orden: {
    numero: "OS-1",
    kilometrajeIngreso: 12000,
    motocicleta: { placa: "ABC12D", marca: "Honda", modelo: "CB", anio: 2020 },
  },
  ...extra,
});

const config = {
  empresa: {
    tipoPersona: "JURIDICA",
    nit: "900123456",
    digitoVerificacion: "8",
    razonSocial: "Taller",
    responsabilidadesFiscales: "O-13",
    codigoMunicipio: "05001",
    ciudad: "Medellin",
    departamento: "Antioquia",
    direccion: "Calle 1",
    telefono: "300",
    email: "t@x.co",
  },
  numeracion: { ambiente: "HABILITACION", softwareId: "sw-1" },
  claveTecnica: "clave",
  pin: "12345",
};

const RESULTADO = {
  estado: "VALIDADO",
  codigo: "00",
  mensaje: "ok",
  errores: [] as { regla: string; mensaje: string }[],
  recibidoEn: "2026-10-21T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getFactura.mockResolvedValue(factura());
  m.emision.mockResolvedValue(config);
  m.certificado.mockResolvedValue({ certificadoBase64: "cert" });
  m.updateAndCount.mockResolvedValue(1);
  m.aggregate.mockResolvedValue({ total: 2 });
  m.leer.mockResolvedValue(Buffer.from("<xml/>"));
  m.firmar.mockResolvedValue("<firmado/>");
  m.guardar.mockImplementation(async (ruta: string) => ruta);
  m.gwEnviar.mockResolvedValue(RESULTADO);
});

describe("dian.service: mapeos", () => {
  it("parteAdquirente: NIT es persona juridica y el consumidor final se rotula", () => {
    expect(parteAdquirente(cliente({ tipoIdentificacion: "NIT" }) as never)).toMatchObject({
      tipoPersona: "1",
      tipoDocumento: "31",
    });
    const cc = parteAdquirente(cliente() as never);
    expect(cc).toMatchObject({ tipoPersona: "2", tipoDocumento: "13", nombre: "Carlos Perez", responsableIva: false });
    expect(parteAdquirente(cliente({ numeroIdentificacion: "222222222222" }) as never).nombre).toBe("Consumidor final");
  });

  it("lineasFactura usa el tratamiento de la orden o lo deduce de la tarifa", () => {
    const f = factura({
      detallesFacturas: [
        detalle(),
        detalle({ detalleOrden: null, tarifaIva: "19.00" }),
        detalle({ detalleOrden: null, tarifaIva: "0.00" }),
      ],
    });
    expect(lineasFactura(f as never).map((l) => l.tratamientoIva)).toEqual(["GRAVADO", "GRAVADO", "EXCLUIDO"]);
    expect(lineasFactura(f as never)[0]).toMatchObject({ codigo: "A1", precioUnitario: "100.00" });
  });
});

describe("dian.service: cargarContextoDian", () => {
  it("arma emisor, ambiente, software y gateway desde la configuracion", async () => {
    const ctx = await cargarContextoDian();
    expect(m.emision).toHaveBeenCalledWith({ transmitir: true });
    expect(ctx.emisor).toMatchObject({
      tipoPersona: "1",
      numeroDocumento: "900123456",
      responsabilidades: "O-13",
      ubicacion: { departamentoCodigo: "05", municipioCodigo: "05001" },
    });
    expect(ctx.ambiente).toBe("2");
    expect(ctx.software).toEqual({ id: "sw-1", pin: "12345", nitProveedor: "900123456", dvProveedor: "8" });
    expect(m.gwArgs).toEqual(["clave", "12345"]);
  });

  it("persona natural y produccion", async () => {
    m.emision.mockResolvedValue({
      ...config,
      empresa: { ...config.empresa, tipoPersona: "NATURAL" },
      numeracion: { ambiente: "PRODUCCION", softwareId: "s" },
    });
    const ctx = await cargarContextoDian();
    expect(ctx.emisor.tipoPersona).toBe("2");
    expect(ctx.ambiente).toBe("1");
  });
});

describe("dian.service: enviarFactura", () => {
  it("firma el XML original, lo guarda, transmite y registra intento + estado VALIDADA", async () => {
    const r = await enviarFactura("f1");

    expect(m.where).toHaveBeenCalledWith({
      and: [{ id: "f1" }, { or: [{ estadoDian: "PENDIENTE_ENVIO" }, { estadoDian: "RECHAZADA" }] }],
    });
    expect(m.updateAndCount).toHaveBeenCalledWith({ estadoDian: "ENVIADA" });
    expect(m.leer).toHaveBeenCalledWith("facturas/SETP1.xml");
    expect(m.firmar).toHaveBeenCalledWith("<xml/>", { certificadoBase64: "cert" });
    expect(m.guardar).toHaveBeenCalledWith("facturas/SETP1.firmado.xml", "<firmado/>", "application/xml");
    expect(m.gwEnviar).toHaveBeenCalledWith("<firmado/>");
    expect(m.guardar).toHaveBeenCalledWith("respuestas/SETP1-intento-3.json", expect.any(String), "application/json");
    expect(m.envioCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        facturaId: "f1",
        numeroIntento: 3,
        estado: "VALIDADO",
        codigoRespuesta: "00",
        mensajeRespuesta: "ok",
        respuestaPath: "respuestas/SETP1-intento-3.json",
      }),
    );
    expect(m.facturaUpdate).toHaveBeenCalledWith({
      estadoDian: "VALIDADA",
      xmlPath: "facturas/SETP1.firmado.xml",
    });
    expect(r.resultado).toBe(RESULTADO);
  });

  it("un rechazo deja la factura RECHAZADA con las reglas en el mensaje", async () => {
    m.gwEnviar.mockResolvedValue({
      ...RESULTADO,
      estado: "RECHAZADO",
      codigo: "99",
      mensaje: "mal",
      errores: [{ regla: "SIM-CUFE", mensaje: "no coincide" }],
    });
    await enviarFactura("f1");
    expect(m.envioCreate).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "RECHAZADO", mensajeRespuesta: "mal\nSIM-CUFE: no coincide" }),
    );
    expect(m.facturaUpdate).toHaveBeenCalledWith(expect.objectContaining({ estadoDian: "RECHAZADA" }));
  });

  it("rechaza con 409 una factura ya validada sin tocar nada", async () => {
    m.getFactura.mockResolvedValue(factura({ estadoDian: "VALIDADA" }));
    await expect(enviarFactura("f1")).rejects.toMatchObject({ statusCode: 409 });
    expect(m.emision).not.toHaveBeenCalled();
    expect(m.updateAndCount).not.toHaveBeenCalled();
  });

  it("rechaza con 400 una factura sin documento electronico o sin CUFE", async () => {
    m.getFactura.mockResolvedValue(factura({ xmlPath: null }));
    await expect(enviarFactura("f1")).rejects.toMatchObject({ statusCode: 400 });
    m.getFactura.mockResolvedValue(factura({ cufe: null }));
    await expect(enviarFactura("f1")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("si la configuracion falla no marca la factura como enviada", async () => {
    m.emision.mockRejectedValue(new Error("config"));
    await expect(enviarFactura("f1")).rejects.toThrow("config");
    expect(m.updateAndCount).not.toHaveBeenCalled();
  });

  it("responde 409 si otro proceso ya tomo la factura", async () => {
    m.updateAndCount.mockResolvedValue(0);
    await expect(enviarFactura("f1")).rejects.toMatchObject({ statusCode: 409 });
    expect(m.firmar).not.toHaveBeenCalled();
  });

  it("un fallo de red restaura el estado, registra ERROR_CONEXION y responde 503", async () => {
    m.gwEnviar.mockRejectedValue(new Error("timeout"));
    await expect(enviarFactura("f1")).rejects.toMatchObject({ statusCode: 503 });
    expect(m.facturaUpdate).toHaveBeenCalledWith({ estadoDian: "PENDIENTE_ENVIO" });
    expect(m.envioCreate).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "ERROR_CONEXION", mensajeRespuesta: "timeout", respuestaPath: null, numeroIntento: 3 }),
    );
  });

  it("un error con statusCode se propaga tal cual y uno no-Error se registra como desconocido", async () => {
    const http = Object.assign(new Error("storage caido"), { statusCode: 503 });
    m.leer.mockRejectedValue(http);
    await expect(enviarFactura("f1")).rejects.toBe(http);

    m.leer.mockRejectedValue("texto");
    await expect(enviarFactura("f1")).rejects.toMatchObject({ statusCode: 503 });
    expect(m.envioCreate).toHaveBeenLastCalledWith(expect.objectContaining({ mensajeRespuesta: "Error desconocido" }));
  });

  it("al reintentar una RECHAZADA, el rollback devuelve RECHAZADA", async () => {
    m.getFactura.mockResolvedValue(factura({ estadoDian: "RECHAZADA" }));
    m.firmar.mockRejectedValue(new Error("firma"));
    await expect(enviarFactura("f1")).rejects.toBeTruthy();
    expect(m.facturaUpdate).toHaveBeenCalledWith({ estadoDian: "RECHAZADA" });
  });
});

describe("dian.service: envios y PDF", () => {
  it("listEnviosFactura valida la factura y devuelve los intentos", async () => {
    m.envioAll.mockResolvedValue([{ numeroIntento: 2 }]);
    expect(await listEnviosFactura("f1")).toEqual([{ numeroIntento: 2 }]);
    expect(m.getFactura).toHaveBeenCalledWith("f1");
  });

  it("getPdfFactura arma los datos con empresa, resolucion y vehiculo", async () => {
    m.empresaFirst.mockResolvedValue({
      id: "e1",
      razonSocial: "Taller",
      nit: "900123456",
      digitoVerificacion: "8",
      direccion: "Calle 1",
      telefono: "300",
      email: "t@x.co",
      regimenFiscal: "Comun",
    });
    m.dianFirst.mockResolvedValue({
      ambiente: "PRODUCCION",
      numeroResolucion: "123",
      fechaResolucion: Temporal.PlainDate.from("2026-01-01"),
      vigenciaHasta: Temporal.PlainDate.from("2027-01-01"),
      prefijoFacturacion: null,
      rangoDesde: null,
      rangoHasta: null,
    });
    m.render.mockResolvedValue(Buffer.from("%PDF"));

    const r = await getPdfFactura("f1");
    expect(r).toEqual({ nombre: "SETP1.pdf", contenido: Buffer.from("%PDF") });
    const datos = m.render.mock.calls[0]![0];
    expect(datos).toMatchObject({
      numero: "SETP1",
      fechaEmision: "2026-10-21 10:30",
      fechaVencimiento: "2026-11-21",
      ambiente: "1",
      empresa: { nit: "900123456", dv: "8" },
      resolucion: { numero: "123", prefijo: "", desde: 0, hasta: 0, vigenciaHasta: "2027-01-01" },
      cliente: { documento: "CC 1020304050" },
      orden: { numero: "OS-1", placa: "ABC12D", vehiculo: "Honda CB 2020", kilometraje: 12000 },
      totales: { total: "119.00" },
    });
  });

  it("getPdfFactura sin empresa, resolucion ni moto usa valores vacios", async () => {
    m.empresaFirst.mockResolvedValue(null);
    m.getFactura.mockResolvedValue(
      factura({
        fechaVencimiento: null,
        cliente: cliente({ tipoIdentificacion: "NIT", digitoVerificacion: "5" }),
        orden: { numero: "OS-2", kilometrajeIngreso: 0, motocicleta: null },
      }),
    );
    m.render.mockResolvedValue(Buffer.from("x"));
    await getPdfFactura("f1");
    expect(m.dianFirst).not.toHaveBeenCalled();
    expect(m.render.mock.calls[0]![0]).toMatchObject({
      ambiente: "2",
      fechaVencimiento: null,
      empresa: { razonSocial: "", nit: "", dv: null },
      resolucion: null,
      cliente: { documento: "NIT 1020304050-5" },
      orden: { placa: "", vehiculo: "" },
    });
  });

  it("vehiculo sin anio y resolucion incompleta", async () => {
    m.empresaFirst.mockResolvedValue({ id: "e1" });
    m.dianFirst.mockResolvedValue({ ambiente: "HABILITACION", numeroResolucion: "1", fechaResolucion: null, vigenciaHasta: null });
    m.getFactura.mockResolvedValue(
      factura({ orden: { numero: "OS", kilometrajeIngreso: 1, motocicleta: { placa: "P", marca: "Yamaha", modelo: "FZ", anio: null } } }),
    );
    m.render.mockResolvedValue(Buffer.from("x"));
    await getPdfFactura("f1");
    const datos = m.render.mock.calls[0]![0];
    expect(datos.orden.vehiculo).toBe("Yamaha FZ");
    expect(datos.resolucion).toBeNull();
  });

  it("getPdfFactura exige orden asociada", async () => {
    m.empresaFirst.mockResolvedValue(null);
    m.getFactura.mockResolvedValue(factura({ orden: null }));
    await expect(getPdfFactura("f1")).rejects.toMatchObject({ statusCode: 400 });
    expect(m.render).not.toHaveBeenCalled();
  });
});

describe("dian.controller", () => {
  const req = { params: { id: "f1" } } as unknown as Request;
  const res = () => {
    const r = {
      json: vi.fn(),
      send: vi.fn(),
      type: vi.fn(),
      attachment: vi.fn(),
    };
    r.type.mockReturnValue(r);
    r.attachment.mockReturnValue(r);
    return r;
  };

  it("enviar responde { data } con factura y resultado", async () => {
    const r = res();
    enviarFacturaController(req, r as unknown as Response, vi.fn());
    await vi.waitFor(() => expect(r.json).toHaveBeenCalled());
    expect(r.json.mock.calls[0]![0].data.resultado).toBe(RESULTADO);
  });

  it("enviar manda el error a next", async () => {
    m.updateAndCount.mockResolvedValue(0);
    const next = vi.fn();
    enviarFacturaController(req, res() as unknown as Response, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    expect(next.mock.calls[0]![0]).toMatchObject({ statusCode: 409 });
  });

  it("listar responde los intentos", async () => {
    m.envioAll.mockResolvedValue([{ numeroIntento: 1 }]);
    const r = res();
    listEnviosController(req, r as unknown as Response, vi.fn());
    await vi.waitFor(() => expect(r.json).toHaveBeenCalledWith({ data: [{ numeroIntento: 1 }] }));
  });

  it("pdf responde application/pdf como adjunto", async () => {
    m.empresaFirst.mockResolvedValue(null);
    m.render.mockResolvedValue(Buffer.from("%PDF-x"));
    const r = res();
    getPdfController(req, r as unknown as Response, vi.fn());
    await vi.waitFor(() => expect(r.send).toHaveBeenCalled());
    expect(r.type).toHaveBeenCalledWith("application/pdf");
    expect(r.attachment).toHaveBeenCalledWith("SETP1.pdf");
    expect(r.send).toHaveBeenCalledWith(Buffer.from("%PDF-x"));
  });
});
