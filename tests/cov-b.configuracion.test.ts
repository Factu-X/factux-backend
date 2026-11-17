import "temporal-polyfill/global";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  admin: null as null | { rpc: ReturnType<typeof vi.fn>; storage: { from: ReturnType<typeof vi.fn> } },
  empresaFirst: vi.fn(),
  empresaUpdate: vi.fn(),
  empresaCreate: vi.fn(),
  dianFirst: vi.fn(),
  dianUpdate: vi.fn(),
  dianCreate: vi.fn(),
  facturaFirst: vi.fn(),
  facturaWhere: vi.fn(),
  leerP12: vi.fn(),
}));

vi.mock("../src/config/supabase.js", () => ({
  get supabaseAdmin() {
    return m.admin;
  },
}));

vi.mock("../src/modules/dian/signer.js", () => ({ leerCertificadoP12: m.leerP12 }));

vi.mock("../src/prisma/db.js", () => {
  const db = {
    orm: {
      public: {
        ConfiguracionEmpresa: {
          where: () => ({ first: m.empresaFirst, update: m.empresaUpdate }),
          create: m.empresaCreate,
        },
        ConfiguracionDian: {
          where: () => ({ first: m.dianFirst, update: m.dianUpdate }),
          create: m.dianCreate,
        },
        Facturas: {
          where: (arg: unknown) => {
            m.facturaWhere(typeof arg === "function" ? arg({ prefijo: { isNull: () => "isNull" } }) : arg);
            return {
              orderBy: (fn: (f: unknown) => unknown) => {
                fn({ consecutivo: { desc: () => "desc" } });
                return { limit: () => ({ first: m.facturaFirst }) };
              },
            };
          },
        },
      },
    },
    transaction: (fn: (tx: unknown) => unknown) => fn(db),
  };
  return { db };
});

import {
  getCertificadoFirma,
  getConfiguracion,
  getConfiguracionEmision,
  leerSecreto,
  requireSecretsClient,
  updateCertificado,
  updateCredenciales,
  updateEmpresa,
  updateNumeracion,
} from "../src/modules/configuracion/configuracion.service.js";
import {
  getConfiguracionController,
  updateCertificadoController,
  updateEmpresaController,
} from "../src/modules/configuracion/configuracion.controller.js";
import { SECRETOS } from "../src/modules/configuracion/configuracion.rules.js";

const hoy = Temporal.Now.plainDateISO("America/Bogota");
const empresaRow = {
  id: "emp-1",
  nit: "900123456",
  digitoVerificacion: "8",
  razonSocial: "Taller",
  direccion: "Calle 1",
  ciudad: "Medellin",
  departamento: "Antioquia",
  codigoMunicipio: "05001",
  telefono: "3000000",
  email: "a@b.co",
  responsabilidadesFiscales: "R-99-PN",
};
const numeracionRow = (extra: Record<string, unknown> = {}) => ({
  id: "num-1",
  empresaId: "emp-1",
  ambiente: "HABILITACION",
  prefijoFacturacion: "SETP",
  numeroResolucion: "123",
  fechaResolucion: hoy.subtract({ days: 100 }),
  rangoDesde: 1,
  rangoHasta: 1000,
  consecutivoActual: 10,
  vigenciaDesde: hoy.subtract({ days: 100 }),
  vigenciaHasta: hoy.add({ days: 200 }),
  softwareId: "sw",
  testSetId: "ts",
  certificadoPath: "dian/certificado.p12",
  certificadoExpira: hoy.add({ days: 100 }),
  updatedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
  ...extra,
});

const nuevoAdmin = (secretos: string[] = Object.values(SECRETOS)) => ({
  rpc: vi.fn(async (nombre: string) =>
    nombre === "factux_secretos_configurados" ? { data: secretos, error: null } : { data: "valor", error: null },
  ),
  storage: {
    from: vi.fn(() => ({
      upload: vi.fn(async () => ({ error: null })),
      download: vi.fn(async () => ({ data: { arrayBuffer: async () => new Uint8Array([1, 2]).buffer }, error: null })),
    })),
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  m.admin = nuevoAdmin();
  m.empresaFirst.mockResolvedValue(empresaRow);
  m.dianFirst.mockResolvedValue(numeracionRow());
  m.facturaFirst.mockResolvedValue(null);
  m.dianUpdate.mockResolvedValue({ id: "num-1" });
  m.dianCreate.mockImplementation(async (d: unknown) => d);
});

describe("configuracion: cliente de secretos", () => {
  it("sin service role responde 503", () => {
    m.admin = null;
    expect(() => requireSecretsClient()).toThrowError(expect.objectContaining({ statusCode: 503 }));
  });

  it("leerSecreto devuelve el valor, null si no hay y propaga el error de Vault", async () => {
    expect(await leerSecreto("x")).toBe("valor");
    m.admin!.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await leerSecreto("x")).toBeNull();
    m.admin!.rpc.mockResolvedValueOnce({ data: null, error: new Error("vault") });
    await expect(leerSecreto("x")).rejects.toThrow("vault");
  });
});

describe("configuracion: getConfiguracion", () => {
  it("el administrador ve credenciales sin valores y la numeracion calculada", async () => {
    const r = await getConfiguracion("ADMINISTRADOR");
    expect(r.numeracion).toMatchObject({ siguienteConsecutivo: 11, disponibles: 990, prefijoFacturacion: "SETP" });
    expect(r.credenciales).toMatchObject({
      softwareId: "sw",
      pinConfigurado: true,
      claveTecnicaConfigurada: true,
      certificadoCargado: true,
      servicioSecretosDisponible: true,
    });
    expect(JSON.stringify(r)).not.toContain("valor");
    expect(r.estado.puedeEmitir).toBe(true);
  });

  it("otros roles no reciben credenciales", async () => {
    expect((await getConfiguracion("MECANICO" as never)).credenciales).toBeUndefined();
  });

  it("sin empresa ni numeracion ni service role reporta pendiente", async () => {
    m.admin = null;
    m.empresaFirst.mockResolvedValue(null);
    const r = await getConfiguracion("ADMINISTRADOR");
    expect(r.numeracion).toBeNull();
    expect(r.credenciales).toMatchObject({
      softwareId: null,
      pinConfigurado: false,
      certificadoCargado: false,
      servicioSecretosDisponible: false,
    });
    expect(r.estado.puedeEmitir).toBe(false);
  });

  it("sin rango definido disponibles es 0 y el certificado sin clave no cuenta como cargado", async () => {
    m.admin = nuevoAdmin([SECRETOS.pin]);
    m.dianFirst.mockResolvedValue(numeracionRow({ rangoDesde: null, rangoHasta: null }));
    const r = await getConfiguracion("ADMINISTRADOR");
    expect(r.numeracion).toMatchObject({ siguienteConsecutivo: null, disponibles: 0 });
    expect(r.credenciales!.certificadoCargado).toBe(false);
  });

  it("rango agotado no da disponibles negativos", async () => {
    m.dianFirst.mockResolvedValue(numeracionRow({ consecutivoActual: 1000 }));
    expect((await getConfiguracion("ADMINISTRADOR")).numeracion!.disponibles).toBe(0);
  });

  it("propaga el error al consultar Vault y trata data null como sin secretos", async () => {
    m.admin!.rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(getConfiguracion("ADMINISTRADOR")).rejects.toEqual({ message: "boom" });
    m.admin!.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect((await getConfiguracion("ADMINISTRADOR")).credenciales!.pinConfigurado).toBe(false);
  });
});

describe("configuracion: getConfiguracionEmision", () => {
  it("devuelve empresa, numeracion y secretos cuando todo esta completo", async () => {
    const r = await getConfiguracionEmision();
    expect(r).toMatchObject({ claveTecnica: "valor", pin: "valor" });
    expect(r.empresa.nit).toBe("900123456");
  });

  it("falla con 400 listando lo faltante", async () => {
    m.empresaFirst.mockResolvedValue({ ...empresaRow, telefono: null });
    await expect(getConfiguracionEmision()).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("Telefono"),
    });
  });

  it("al transmitir exige ademas certificado y TestSetId", async () => {
    m.dianFirst.mockResolvedValue(numeracionRow({ testSetId: null }));
    await expect(getConfiguracionEmision()).resolves.toBeTruthy();
    await expect(getConfiguracionEmision({ transmitir: true })).rejects.toMatchObject({
      message: expect.stringContaining("TestSetId"),
    });
  });

  it("falla si no hay empresa o numeracion", async () => {
    m.admin = null;
    m.empresaFirst.mockResolvedValue(null);
    await expect(getConfiguracionEmision()).rejects.toMatchObject({ statusCode: 400 });
  });

  it("falla si Vault devuelve vacia la clave tecnica o el PIN", async () => {
    m.admin!.rpc.mockImplementation(async (n: string) =>
      n === "factux_secretos_configurados"
        ? { data: Object.values(SECRETOS), error: null }
        : { data: null, error: null },
    );
    await expect(getConfiguracionEmision()).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("PIN"),
    });
  });
});

describe("configuracion: updateEmpresa", () => {
  const input = {
    nit: "900123456",
    digitoVerificacion: "8",
    razonSocial: "Taller",
    tipoPersona: "JURIDICA",
    responsabilidadesFiscales: "R-99-PN",
    direccion: "Calle 1",
    ciudad: "Medellin",
    departamento: "Antioquia",
    codigoMunicipio: "05001",
    telefono: "3000000",
    email: "a@b.co",
  } as const;

  it("rechaza un DV que no corresponde al NIT sin escribir nada", async () => {
    await expect(updateEmpresa({ ...input, digitoVerificacion: "1" })).rejects.toMatchObject({ statusCode: 400 });
    expect(m.empresaCreate).not.toHaveBeenCalled();
    expect(m.empresaUpdate).not.toHaveBeenCalled();
  });

  it("actualiza la empresa existente", async () => {
    await updateEmpresa(input);
    expect(m.empresaUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ nit: "900123456", nombreComercial: null, regimenFiscal: null }),
    );
    expect(m.empresaCreate).not.toHaveBeenCalled();
  });

  it("crea la empresa singleton si no existe", async () => {
    m.empresaFirst.mockResolvedValue(null);
    await updateEmpresa({ ...input, nombreComercial: "Moto" });
    expect(m.empresaCreate).toHaveBeenCalledWith(
      expect.objectContaining({ singleton: true, nombreComercial: "Moto" }),
    );
  });
});

describe("configuracion: updateNumeracion", () => {
  const input = {
    ambiente: "HABILITACION" as const,
    prefijoFacturacion: "SETP",
    numeroResolucion: "123",
    fechaResolucion: "2026-01-01",
    rangoDesde: 1,
    rangoHasta: 1000,
    vigenciaDesde: "2026-01-01",
    vigenciaHasta: "2027-01-01",
  };

  it("exige que exista la empresa", async () => {
    m.empresaFirst.mockResolvedValue(null);
    await expect(updateNumeracion(input)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("crea la numeracion con el consecutivo en rangoDesde - 1", async () => {
    m.dianFirst.mockResolvedValue(null);
    await updateNumeracion({ ...input, rangoDesde: 50 });
    expect(m.dianCreate).toHaveBeenCalledWith(
      expect.objectContaining({ empresaId: "emp-1", consecutivoActual: 49, rangoDesde: 50 }),
    );
  });

  it("nunca retrocede el consecutivo: usa el mayor entre actual y facturas emitidas", async () => {
    m.facturaFirst.mockResolvedValue({ consecutivo: 30 });
    await updateNumeracion(input);
    expect(m.dianUpdate).toHaveBeenCalledWith(expect.objectContaining({ consecutivoActual: 30 }));
    expect(m.facturaWhere).toHaveBeenCalledWith({ prefijo: "SETP" });
  });

  it("sin prefijo busca facturas sin prefijo y no hereda el consecutivo", async () => {
    await updateNumeracion({ ...input, prefijoFacturacion: null });
    expect(m.facturaWhere).toHaveBeenCalledWith("isNull");
    expect(m.dianUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ consecutivoActual: 0, prefijoFacturacion: null }),
    );
  });

  it("rechaza un rango hasta menor al ultimo emitido", async () => {
    await expect(updateNumeracion({ ...input, rangoHasta: 5 })).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("10"),
    });
    expect(m.dianUpdate).not.toHaveBeenCalled();
  });

  it("responde 409 si se emitio una factura mientras se guardaba", async () => {
    m.dianUpdate.mockResolvedValue(null);
    await expect(updateNumeracion(input)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("actualiza sin condicionar cuando el consecutivo guardado era null", async () => {
    m.dianFirst.mockResolvedValue(numeracionRow({ consecutivoActual: null }));
    await updateNumeracion(input);
    expect(m.dianUpdate).toHaveBeenCalledWith(expect.objectContaining({ consecutivoActual: 0 }));
  });
});

describe("configuracion: updateCredenciales", () => {
  it("guarda softwareId y testSetId en la base y PIN/clave en Vault", async () => {
    await updateCredenciales({ softwareId: "sw2", testSetId: null, pin: "123", claveTecnica: "clave" });
    expect(m.dianUpdate).toHaveBeenCalledWith(expect.objectContaining({ softwareId: "sw2", testSetId: null }));
    expect(m.admin!.rpc).toHaveBeenCalledWith("factux_guardar_secreto", { p_nombre: SECRETOS.pin, p_valor: "123" });
    expect(m.admin!.rpc).toHaveBeenCalledWith("factux_guardar_secreto", {
      p_nombre: SECRETOS.claveTecnica,
      p_valor: "clave",
    });
  });

  it("solo testSetId no toca softwareId ni Vault", async () => {
    await updateCredenciales({ testSetId: "t" });
    const arg = m.dianUpdate.mock.calls[0]![0];
    expect(arg).not.toHaveProperty("softwareId");
    expect(m.admin!.rpc).not.toHaveBeenCalled();
  });

  it("solo un secreto no exige numeracion", async () => {
    m.dianFirst.mockResolvedValue(null);
    await updateCredenciales({ pin: "9" });
    expect(m.dianUpdate).not.toHaveBeenCalled();
  });

  it("exige numeracion para guardar softwareId", async () => {
    m.dianFirst.mockResolvedValue(null);
    await expect(updateCredenciales({ softwareId: "s" })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("propaga el error de Vault al guardar", async () => {
    m.admin!.rpc.mockResolvedValue({ data: null, error: new Error("rpc") });
    await expect(updateCredenciales({ pin: "1" })).rejects.toThrow("rpc");
  });
});

describe("configuracion: certificado", () => {
  const vigente = { venceEl: new Date(Date.now() + 86_400_000) };
  const input = { archivoBase64: Buffer.from("p12").toString("base64"), password: "pw", expira: "2030-01-01" };

  it("sube el .p12, guarda la contrasena y registra la ruta", async () => {
    m.leerP12.mockResolvedValue(vigente);
    const upload = vi.fn(async () => ({ error: null }));
    m.admin!.storage.from.mockReturnValue({ upload });
    await updateCertificado(input);
    expect(upload).toHaveBeenCalledWith("dian/certificado.p12", Buffer.from("p12"), {
      contentType: "application/x-pkcs12",
      upsert: true,
    });
    expect(m.admin!.rpc).toHaveBeenCalledWith("factux_guardar_secreto", {
      p_nombre: SECRETOS.certificadoPassword,
      p_valor: "pw",
    });
    expect(m.dianUpdate).toHaveBeenCalledWith(expect.objectContaining({ certificadoPath: "dian/certificado.p12" }));
  });

  it("rechaza un .p12 ilegible o con contrasena mala y no sube nada", async () => {
    m.leerP12.mockRejectedValue(new Error("mac"));
    await expect(updateCertificado(input)).rejects.toMatchObject({ statusCode: 400 });
    expect(m.dianUpdate).not.toHaveBeenCalled();
  });

  it("rechaza un certificado vencido", async () => {
    m.leerP12.mockResolvedValue({ venceEl: new Date(Date.now() - 1000) });
    await expect(updateCertificado(input)).rejects.toMatchObject({ message: expect.stringContaining("vencido") });
  });

  it("propaga el error del storage y no registra la ruta", async () => {
    m.leerP12.mockResolvedValue(vigente);
    m.admin!.storage.from.mockReturnValue({ upload: async () => ({ error: new Error("storage") }) });
    await expect(updateCertificado(input)).rejects.toThrow("storage");
    expect(m.dianUpdate).not.toHaveBeenCalled();
  });

  it("sin service role responde 503", async () => {
    m.admin = null;
    await expect(updateCertificado(input)).rejects.toMatchObject({ statusCode: 503 });
  });

  it("getCertificadoFirma exige ruta, descarga una vez y reutiliza el cache", async () => {
    await expect(getCertificadoFirma({ certificadoPath: null, updatedAt: Temporal.Now.instant() })).rejects.toMatchObject({
      statusCode: 400,
    });
    const cert = { ...vigente, sujeto: "x" };
    m.leerP12.mockResolvedValue(cert);
    const num = { certificadoPath: "dian/a.p12", updatedAt: Temporal.Instant.from("2026-05-05T00:00:00Z") };
    expect(await getCertificadoFirma(num)).toBe(cert);
    expect(await getCertificadoFirma(num)).toBe(cert);
    expect(m.leerP12).toHaveBeenCalledTimes(1);
    expect(m.leerP12).toHaveBeenCalledWith(Buffer.from([1, 2]), "valor");

    // un updatedAt nuevo invalida el cache
    await getCertificadoFirma({ ...num, updatedAt: Temporal.Instant.from("2026-06-06T00:00:00Z") });
    expect(m.leerP12).toHaveBeenCalledTimes(2);
  });

  it("getCertificadoFirma propaga el error de descarga y usa contrasena vacia si no hay secreto", async () => {
    m.admin!.storage.from.mockReturnValue({ download: async () => ({ data: null, error: new Error("dl") }) });
    await expect(
      getCertificadoFirma({ certificadoPath: "dian/b.p12", updatedAt: Temporal.Instant.from("2026-07-07T00:00:00Z") }),
    ).rejects.toThrow("dl");

    m.admin = nuevoAdmin();
    m.admin.rpc.mockResolvedValue({ data: null, error: null });
    m.leerP12.mockResolvedValue(vigente);
    await getCertificadoFirma({ certificadoPath: "dian/c.p12", updatedAt: Temporal.Instant.from("2026-08-08T00:00:00Z") });
    expect(m.leerP12).toHaveBeenLastCalledWith(expect.any(Buffer), "");
  });
});

describe("configuracion: controladores", () => {
  const res = () => {
    const r = { json: vi.fn() };
    return r as unknown as Response & typeof r;
  };
  const req = (body?: unknown) => ({ body, user: { rol: "ADMINISTRADOR" } }) as unknown as Request;

  it("GET responde con la configuracion segun el rol", async () => {
    const r = res();
    const next = vi.fn();
    getConfiguracionController(req(), r, next);
    await vi.waitFor(() => expect(r.json).toHaveBeenCalled());
    expect(r.json.mock.calls[0]![0].data.credenciales).toBeDefined();
    expect(next).not.toHaveBeenCalled();
  });

  it("guarda y responde la configuracion completa", async () => {
    const r = res();
    updateEmpresaController(req({ ...{ nit: "900123456", digitoVerificacion: "8", razonSocial: "T", tipoPersona: "JURIDICA" } }), r, vi.fn());
    await vi.waitFor(() => expect(r.json).toHaveBeenCalled());
    expect(m.empresaUpdate).toHaveBeenCalled();
    expect(r.json.mock.calls[0]![0].data.empresa).toBeDefined();
  });

  it("los errores del servicio llegan a next", async () => {
    const next = vi.fn();
    m.leerP12.mockRejectedValue(new Error("x"));
    updateCertificadoController(req({ archivoBase64: "AA==", password: "p", expira: "2030-01-01" }), res(), next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    expect(next.mock.calls[0]![0]).toMatchObject({ statusCode: 400 });
  });
});
