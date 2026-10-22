import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RolUsuario } from "../src/modules/auth/types.js";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  findProfile: vi.fn(),
}));

vi.mock("../src/config/supabase.js", () => ({
  supabase: { auth: { getClaims: mocks.getClaims } },
  supabaseAdmin: null,
}));

vi.mock("../src/prisma/db.js", () => ({
  db: { orm: { public: { Profiles: { first: mocks.findProfile } } } },
}));

// Los servicios se automockean: aqui solo se prueba quien puede llegar a cada endpoint.
vi.mock("../src/modules/catalogo/catalogo.service.js");
vi.mock("../src/modules/clientes/clientes.service.js");
vi.mock("../src/modules/motocicletas/motocicletas.service.js");
vi.mock("../src/modules/ordenes/ordenes.service.js");
vi.mock("../src/modules/facturas/facturas.service.js");
vi.mock("../src/modules/usuarios/usuarios.service.js");
vi.mock("../src/modules/configuracion/configuracion.service.js");
vi.mock("../src/modules/dian/dian.service.js");
vi.mock("../src/modules/notas-credito/notas-credito.service.js");
vi.mock("../src/modules/cartera/cartera.service.js");
vi.mock("../src/modules/reportes/reportes.service.js");

const { app } = await import("../src/app.js");

const ID = "550e8400-e29b-41d4-a716-446655440000";

type Method = "get" | "post" | "put" | "patch" | "delete";

const loginAs = (rol: RolUsuario) => {
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: ID } }, error: null });
  mocks.findProfile.mockResolvedValue({ id: ID, nombre: "Usuario", rol, activo: true });
};

const call = (method: Method, path: string, body?: object) => {
  const req = request(app)[method](path).set("Authorization", "Bearer token");
  return body ? req.send(body) : req;
};

const cliente = {
  tipoIdentificacion: "CC",
  numeroIdentificacion: "123456",
  nombreRazonSocial: "Cliente",
};
const moto = { placa: "ABC12D", marca: "Yamaha", modelo: "FZ", anio: 2022 };
const catalogoItem = {
  codigo: "SRV-1",
  nombre: "Cambio de aceite",
  tipo: "SERVICIO",
  precioVenta: 10000,
  tratamientoIva: "GRAVADO",
  tarifaIva: 19,
};
const orden = {
  clienteId: ID,
  motocicletaId: ID,
  kilometrajeIngreso: 1000,
  motivoIngreso: "Revision",
};
const usuario = {
  nombre: "Ana",
  email: "ana@factux.co",
  password: "secreta123",
  rol: "FACTURACION",
};

const numeracion = {
  ambiente: "HABILITACION",
  prefijoFacturacion: "SETP",
  numeroResolucion: "18760000001",
  fechaResolucion: "2026-01-01",
  rangoDesde: 990000000,
  rangoHasta: 995000000,
  vigenciaDesde: "2026-01-01",
  vigenciaHasta: "2027-12-31",
};

const ALL_OK = { ADMINISTRADOR: 200, FACTURACION: 200, OPERADOR: 200 };

const matrix: [Method, string, object | undefined, Record<RolUsuario, number>][] = [
  ["get", "/api/clientes", undefined, ALL_OK],
  ["post", "/api/clientes", cliente, { ADMINISTRADOR: 201, FACTURACION: 201, OPERADOR: 403 }],
  [
    "patch",
    `/api/clientes/${ID}`,
    { telefono: "300" },
    { ADMINISTRADOR: 200, FACTURACION: 200, OPERADOR: 403 },
  ],
  [
    "post",
    `/api/clientes/${ID}/motocicletas`,
    moto,
    { ADMINISTRADOR: 201, FACTURACION: 201, OPERADOR: 403 },
  ],
  ["get", `/api/motocicletas/${ID}`, undefined, ALL_OK],
  ["get", "/api/catalogo", undefined, ALL_OK],
  ["post", "/api/catalogo", catalogoItem, { ADMINISTRADOR: 201, FACTURACION: 403, OPERADOR: 403 }],
  ["get", "/api/ordenes", undefined, ALL_OK],
  ["post", "/api/ordenes", orden, { ADMINISTRADOR: 201, FACTURACION: 201, OPERADOR: 403 }],
  [
    "post",
    `/api/ordenes/${ID}/detalles`,
    { itemCatalogoId: ID },
    { ADMINISTRADOR: 201, FACTURACION: 201, OPERADOR: 201 },
  ],
  ["get", "/api/facturas", undefined, { ADMINISTRADOR: 200, FACTURACION: 200, OPERADOR: 403 }],
  [
    "post",
    "/api/facturas",
    { ordenId: ID },
    { ADMINISTRADOR: 201, FACTURACION: 201, OPERADOR: 403 },
  ],
  [
    "get",
    "/api/configuracion",
    undefined,
    { ADMINISTRADOR: 200, FACTURACION: 200, OPERADOR: 403 },
  ],
  [
    "put",
    "/api/configuracion/numeracion",
    numeracion,
    { ADMINISTRADOR: 200, FACTURACION: 403, OPERADOR: 403 },
  ],
  [
    "put",
    "/api/configuracion/credenciales",
    { pin: "12345" },
    { ADMINISTRADOR: 200, FACTURACION: 403, OPERADOR: 403 },
  ],
  ["get", "/api/usuarios", undefined, { ADMINISTRADOR: 200, FACTURACION: 403, OPERADOR: 403 }],
  ["post", "/api/usuarios", usuario, { ADMINISTRADOR: 201, FACTURACION: 403, OPERADOR: 403 }],
  ["post", `/api/facturas/${ID}/enviar`, undefined, { ADMINISTRADOR: 200, FACTURACION: 200, OPERADOR: 403 }],
  ["get", `/api/facturas/${ID}/envios`, undefined, { ADMINISTRADOR: 200, FACTURACION: 200, OPERADOR: 403 }],
  ["get", "/api/notas-credito", undefined, { ADMINISTRADOR: 200, FACTURACION: 200, OPERADOR: 403 }],
  [
    "post",
    "/api/notas-credito",
    { facturaId: ID, tipoAjuste: "TOTAL", motivo: "Anulacion por error" },
    { ADMINISTRADOR: 201, FACTURACION: 201, OPERADOR: 403 },
  ],
  ["get", "/api/cartera", undefined, { ADMINISTRADOR: 200, FACTURACION: 200, OPERADOR: 403 }],
  [
    "post",
    `/api/facturas/${ID}/pagos`,
    { monto: 1000, metodoPago: "EFECTIVO" },
    { ADMINISTRADOR: 201, FACTURACION: 201, OPERADOR: 403 },
  ],
  ["get", "/api/reportes/facturacion", undefined, { ADMINISTRADOR: 200, FACTURACION: 200, OPERADOR: 403 }],
];

describe("role based access", () => {
  beforeEach(() => {
    mocks.getClaims.mockReset();
    mocks.findProfile.mockReset();
  });

  for (const [method, path, body, expected] of matrix) {
    for (const [rol, status] of Object.entries(expected) as [RolUsuario, number][]) {
      it(`${rol} ${method.toUpperCase()} ${path} -> ${status}`, async () => {
        loginAs(rol);
        await call(method, path, body).expect(status);
      });
    }
  }

  it("lets the operator advance the order state and notes", async () => {
    loginAs("OPERADOR");
    await call("patch", `/api/ordenes/${ID}`, {
      estado: "EN_PROCESO",
      observaciones: "Listo",
    }).expect(200);
  });

  it("blocks the operator from editing reception data", async () => {
    loginAs("OPERADOR");
    const response = await call("patch", `/api/ordenes/${ID}`, {
      motivoIngreso: "Otro motivo",
    }).expect(403);

    expect(response.body.error.message).toContain("motivoIngreso");
  });

  it("blocks the operator from cancelling orders", async () => {
    loginAs("OPERADOR");
    await call("patch", `/api/ordenes/${ID}`, { estado: "CANCELADA" }).expect(403);
  });

  it("rejects creating orders already finalized", async () => {
    loginAs("FACTURACION");
    const response = await call("post", "/api/ordenes", {
      ...orden,
      estado: "FINALIZADA",
    }).expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("validates credit notes and payments before reaching the service", async () => {
    loginAs("FACTURACION");
    const responses = await Promise.all([
      call("post", "/api/notas-credito", { facturaId: ID, tipoAjuste: "PARCIAL", motivo: "Devolucion" }),
      call("post", "/api/notas-credito", { facturaId: ID, tipoAjuste: "TOTAL", motivo: "x" }),
      call("post", `/api/facturas/${ID}/pagos`, { monto: 0, metodoPago: "EFECTIVO" }),
      call("post", `/api/facturas/${ID}/pagos`, { monto: 10.123, metodoPago: "EFECTIVO" }),
      call("post", `/api/facturas/${ID}/pagos`, { monto: 10, metodoPago: "CHEQUE" }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("validates user payloads before reaching the service", async () => {
    loginAs("ADMINISTRADOR");
    await call("post", "/api/usuarios", { ...usuario, password: "corta" }).expect(400);
    await call("post", "/api/usuarios", { ...usuario, rol: "SUPERUSUARIO" }).expect(400);
  });

  it("rejects a numbering range that ends before it starts", async () => {
    loginAs("ADMINISTRADOR");
    await call("put", "/api/configuracion/numeracion", {
      ...numeracion,
      rangoDesde: 10,
      rangoHasta: 5,
    }).expect(400);
  });

  it("rejects prefixes longer than the DIAN allows", async () => {
    loginAs("ADMINISTRADOR");
    await call("put", "/api/configuracion/numeracion", {
      ...numeracion,
      prefijoFacturacion: "FACTX",
    }).expect(400);
  });
});
